// Package codex is the Agent adapter of Codex: one `codex app-server`
// process (JSON-RPC over stdio, a message a line) for every Codex
// session, each session a thread of it.
package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// Kind is Codex's kind.
const Kind agent.Kind = "codex"

// Agent runs Codex.
type Agent struct {
	// Path is the codex executable.
	Path string
	// Env is added to the environment of its process.
	Env []string

	mu  sync.Mutex
	srv *server // nil until the first session, or after it exited
}

// New returns the Agent running the codex at path.
func New(path string) *Agent { return &Agent{Path: path} }

func (a *Agent) Kind() agent.Kind { return Kind }
func (a *Agent) Name() string     { return "Codex" }

// ToolName is the tool's own name. How Codex's model sees an MCP
// server's tools is to be measured with ticket 08.
func (a *Agent) ToolName(tool string) string { return tool }

// Approval policy and sandbox until the approval levels (ticket 10): the
// default level, every approval request declined.
const (
	approvalPolicy = "on-request"
	sandbox        = "workspace-write"
)

func (a *Agent) Start(ctx context.Context, opts agent.StartOptions) (agent.Session, error) {
	srv, err := a.server(ctx)
	if err != nil {
		return nil, err
	}
	params := map[string]any{"cwd": opts.Workspace, "approvalPolicy": approvalPolicy, "sandbox": sandbox}
	if opts.Model != "" {
		params["model"] = opts.Model
	}
	method := "thread/start"
	if opts.ResumeID != "" {
		method, params["threadId"] = "thread/resume", opts.ResumeID
	}
	// Notifications before the session is attached (thread/started) are
	// not needed: the call's result names the thread.
	s := &session{srv: srv, events: make(chan agent.Event, 256), parse: newThread()}
	var res struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := srv.call(ctx, method, params, &res); err != nil {
		if opts.ResumeID != "" {
			return nil, fmt.Errorf("续接 Codex thread %s 失败：%w", opts.ResumeID, err)
		}
		return nil, fmt.Errorf("新建 Codex thread 失败：%w", err)
	}
	s.id = res.Thread.ID
	srv.attach(s)
	s.events <- agent.NativeSessionStarted{ID: s.id}
	return s, nil
}

// server returns the running app-server, starting one if none runs.
func (a *Agent) server(ctx context.Context) (*server, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.srv != nil && !a.srv.isDead() {
		return a.srv, nil
	}
	srv, err := startServer(ctx, a.Path, a.Env, func(s *server) {
		a.mu.Lock()
		if a.srv == s {
			a.srv = nil
		}
		a.mu.Unlock()
	})
	if err != nil {
		return nil, err
	}
	a.srv = srv
	return srv, nil
}

// server is a running app-server.
type server struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stderr tail
	onIdle func(*server)
	// wmu orders writes to stdin; not mu, which the reader takes, so that
	// a full pipe cannot hold both.
	wmu sync.Mutex

	mu       sync.Mutex
	nextID   int
	pending  map[int]chan response
	sessions map[string]*session // by thread ID
	dead     bool
	exited   chan struct{}
}

type response struct {
	result json.RawMessage
	err    error
}

type message struct {
	ID     *json.RawMessage `json:"id,omitempty"`
	Method string           `json:"method,omitempty"`
	Params json.RawMessage  `json:"params,omitempty"`
	Result json.RawMessage  `json:"result,omitempty"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func startServer(ctx context.Context, path string, env []string, onIdle func(*server)) (*server, error) {
	cmd := exec.Command(path, "app-server")
	cmd.Env = append(os.Environ(), env...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	s := &server{cmd: cmd, stdin: stdin, onIdle: onIdle, pending: map[int]chan response{}, sessions: map[string]*session{}, exited: make(chan struct{})}
	cmd.Stderr = &s.stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 Codex app-server 失败：%w", err)
	}
	go s.read(stdout)
	init := map[string]any{"clientInfo": map[string]any{"name": "aibo", "version": "0.1"}, "capabilities": map[string]any{"experimentalApi": true}}
	if err := s.call(ctx, "initialize", init, nil); err != nil {
		s.kill()
		return nil, fmt.Errorf("Codex app-server 握手失败：%w", err)
	}
	if err := s.send(map[string]any{"method": "initialized"}); err != nil {
		s.kill()
		return nil, err
	}
	return s, nil
}

func (s *server) isDead() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dead
}

func (s *server) send(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if s.isDead() {
		return errors.New("Codex app-server 已退出")
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_, err = s.stdin.Write(append(b, '\n'))
	return err
}

// call calls a method and decodes its result into out (when not nil).
func (s *server) call(ctx context.Context, method string, params, out any) error {
	s.mu.Lock()
	s.nextID++
	id := s.nextID
	ch := make(chan response, 1)
	s.pending[id] = ch
	s.mu.Unlock()
	if err := s.send(map[string]any{"id": id, "method": method, "params": params}); err != nil {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return err
	}
	var r response
	select {
	case r = <-ch:
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(2 * time.Minute):
		return fmt.Errorf("Codex app-server 没有回应 %s", method)
	}
	if r.err != nil {
		return r.err
	}
	if out != nil && len(r.result) > 0 {
		return json.Unmarshal(r.result, out)
	}
	return nil
}

func (s *server) attach(sess *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sess.id] = sess
}

// detach forgets a session, and stops the server when none is left.
func (s *server) detach(sess *session) {
	s.mu.Lock()
	delete(s.sessions, sess.id)
	idle := len(s.sessions) == 0
	s.mu.Unlock()
	if idle {
		s.onIdle(s)
		s.stop()
	}
}

func (s *server) stop() {
	s.stdin.Close()
	select {
	case <-s.exited:
	case <-time.After(5 * time.Second):
		s.kill()
	}
}

func (s *server) kill() {
	if s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
}

// read dispatches the server's messages until it exits.
func (s *server) read(stdout io.Reader) {
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 64<<20)
	for sc.Scan() {
		var m message
		if json.Unmarshal(sc.Bytes(), &m) != nil {
			continue
		}
		switch {
		case m.Method == "" && m.ID != nil: // a response
			var id int
			if json.Unmarshal(*m.ID, &id) != nil {
				continue
			}
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			if ch != nil {
				r := response{result: m.Result}
				if m.Error != nil {
					r.err = fmt.Errorf("%s（%d）", m.Error.Message, m.Error.Code)
				}
				ch <- r
			}
		case m.ID != nil: // a request of the server
			s.answer(*m.ID, m.Method)
		default:
			s.notify(m.Method, m.Params)
		}
	}
	err := s.cmd.Wait()
	s.mu.Lock()
	s.dead = true
	sessions := s.sessions
	s.sessions = map[string]*session{}
	for id, ch := range s.pending {
		ch <- response{err: errors.New("Codex app-server 已退出")}
		delete(s.pending, id)
	}
	s.mu.Unlock()
	close(s.exited)
	s.onIdle(s)
	msg := "Codex app-server 意外退出"
	if err != nil {
		msg += "（" + err.Error() + "）"
	}
	if t := strings.TrimSpace(s.stderr.String()); t != "" {
		msg += "：" + t
	}
	for _, sess := range sessions {
		sess.ended(msg)
	}
}

// answer answers the server's requests. Approvals come with ticket 10:
// until then, every one is declined.
func (s *server) answer(id json.RawMessage, method string) {
	var result any
	switch method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		result = map[string]any{"decision": "decline"}
	case "mcpServer/elicitation/request":
		result = map[string]any{"action": "decline"}
	default:
		s.send(map[string]any{"id": id, "error": map[string]any{"code": -32601, "message": "aibo 不支持 " + method}})
		return
	}
	s.send(map[string]any{"id": id, "result": result})
}

// notify passes a notification to the session of its thread.
func (s *server) notify(method string, params json.RawMessage) {
	var p struct {
		ThreadID string `json:"threadId"`
	}
	json.Unmarshal(params, &p)
	s.mu.Lock()
	sess := s.sessions[p.ThreadID]
	s.mu.Unlock()
	if sess != nil {
		sess.notify(method, params)
	}
}

// session is one thread.
type session struct {
	srv    *server
	id     string
	events chan agent.Event
	parse  *thread

	mu      sync.Mutex
	turn    string // the running turn's ID
	running bool
	closed  bool
}

func (s *session) Events() <-chan agent.Event { return s.events }

func (s *session) notify(method string, params json.RawMessage) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	evs := s.parse.handle(method, params)
	for _, e := range evs {
		if _, ok := e.(agent.TurnEnded); ok {
			s.running, s.turn = false, ""
		}
	}
	// Under the lock, so that Close does not close events meanwhile.
	for _, e := range evs {
		s.events <- e
	}
	s.mu.Unlock()
}

func (s *session) Send(ctx context.Context, turn agent.Turn) error {
	s.mu.Lock()
	if s.closed || s.running {
		s.mu.Unlock()
		if s.running {
			return errors.New("Codex 正在回复")
		}
		return errors.New("Codex 会话已关闭")
	}
	s.running = true
	s.mu.Unlock()
	var res struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	err := s.srv.call(ctx, "turn/start", map[string]any{"threadId": s.id, "input": []any{map[string]any{"type": "text", "text": turn.Text}}}, &res)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.running = false
		return err
	}
	if s.running { // the turn may have ended already
		s.turn = res.Turn.ID
	}
	return nil
}

func (s *session) Interrupt(ctx context.Context) error {
	s.mu.Lock()
	turn := s.turn
	s.mu.Unlock()
	if turn == "" {
		return nil
	}
	return s.srv.call(ctx, "turn/interrupt", map[string]any{"threadId": s.id, "turnId": turn}, nil)
}

// Close interrupts the running turn and lets the thread go.
func (s *session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	running := s.running
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if running {
		s.Interrupt(ctx)
	}
	s.srv.call(ctx, "thread/unsubscribe", map[string]any{"threadId": s.id}, nil)
	s.srv.detach(s)
	s.ended("")
	return nil
}

// ended closes the session's events: the thread was let go, or the
// server exited (msg) in the middle of a turn.
func (s *session) ended(msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	if s.running {
		if msg != "" {
			s.events <- agent.Failed{Message: msg}
		}
		s.events <- agent.TurnEnded{Interrupted: true}
		s.running = false
	}
	close(s.events)
}

// tail keeps the last few KB written to it: a process's stderr.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 4096 {
		t.buf = t.buf[len(t.buf)-4096:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}
