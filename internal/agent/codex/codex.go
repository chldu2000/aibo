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
	"log/slog"
	"maps"
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
	mu sync.Mutex
	// onAccount is told of sign-ins: their end (LoginDone) and changes of
	// the account.
	onAccount func(AccountEvent)
	// path is the codex executable; env is added to the environment of
	// its process.
	path string
	env  []string
	log  *slog.Logger
	srv  *server // nil until the first session, or after it exited
}

// SetLog sets the diagnostic log of the app-servers to come.
func (a *Agent) SetLog(log *slog.Logger) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.log = log
}

// Configure sets the executable and the environment of the app-server
// started from then on.
func (a *Agent) Configure(path string, env []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.path, a.env = path, env
}

// New returns the Agent running the codex at path.
func New(path string) *Agent { return &Agent{path: path} }

func (a *Agent) Kind() agent.Kind { return Kind }
func (a *Agent) Name() string     { return "Codex" }

// ToolName is how Codex's model names an MCP server's tool, as measured
// with codex-cli 0.169.0: mcp__<server>__<tool>, as Claude does. (The
// app-server's items name it <server>.<tool>; the model never sees that.)
func (a *Agent) ToolName(tool string) string { return "mcp__aibo__" + tool }

func (a *Agent) Start(ctx context.Context, opts agent.StartOptions) (agent.Session, error) {
	srv, err := a.server(ctx)
	if err != nil {
		return nil, err
	}
	params := map[string]any{"cwd": opts.Workspace}
	// No mode is the default preset, Ask for approval: not Codex's own
	// default, which the project's trust decides (Read only in a folder
	// Codex does not trust).
	p, ok := presetOf(opts.Mode)
	if !ok {
		p, _ = presetOf(defaultPreset)
	}
	params["sandbox"], params["approvalPolicy"], params["approvalsReviewer"] = p.sandbox, p.policy, p.reviewer
	if opts.Model != "" {
		params["model"] = opts.Model
	}
	if opts.MCP != nil {
		// This thread's alone: its token in its headers, which a thread's
		// config keeps apart from the other threads'. Its tools need no
		// approval.
		params["config"] = map[string]any{"mcp_servers": map[string]any{"aibo": map[string]any{
			"url":                         opts.MCP.URL,
			"http_headers":                map[string]string{"Authorization": "Bearer " + opts.MCP.Token},
			"default_tools_approval_mode": "approve",
		}}}
	}
	// The effort goes with the first turn: thread/start takes none.
	s := &session{srv: srv, events: make(chan agent.Event, 256), parse: newThread(), rules: opts.Rules, effort: opts.Effort,
		cwd: opts.Workspace, start: maps.Clone(params), current: settings{opts.Mode, opts.Model, opts.Effort}}
	method := "thread/start"
	if opts.ResumeID != "" {
		method, params["threadId"] = "thread/resume", opts.ResumeID
	}
	// Notifications before the session is attached (thread/started) are
	// not needed: the call's result names the thread.
	var raw json.RawMessage
	if err := srv.call(ctx, method, params, &raw); err != nil {
		if opts.ResumeID != "" {
			return nil, fmt.Errorf("%w: %v", agent.ErrResumeFailed, err)
		}
		return nil, fmt.Errorf("%w: thread/start: %w", agent.ErrStartFailed, err)
	}
	var res struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	json.Unmarshal(raw, &res)
	s.id = res.Thread.ID
	srv.attach(s)
	s.events <- agent.NativeSessionStarted{ID: s.id}
	s.events <- threadSettings(raw)
	if m := threadMode(raw); m != "" {
		s.events <- agent.ModeReported{ID: m}
	}
	return s, nil
}

// server returns the running app-server, starting one if none runs.
func (a *Agent) server(ctx context.Context) (*server, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.srv != nil && !a.srv.isDead() {
		return a.srv, nil
	}
	if a.path == "" {
		return nil, agent.ErrNotFound
	}
	log := a.log
	if log == nil {
		log = agent.Discard
	}
	srv, err := startServer(ctx, a.path, a.env, log, func(s *server) {
		a.mu.Lock()
		if a.srv == s {
			a.srv = nil
		}
		a.mu.Unlock()
	}, a.account)
	if err != nil {
		return nil, err
	}
	a.srv = srv
	return srv, nil
}

// server is a running app-server.
type server struct {
	version string
	// log is the diagnostic log; unknown the notifications it did not
	// know, logged once.
	log     *slog.Logger
	unknown map[string]bool
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stderr  tail
	onIdle  func(*server)
	// onAccount gets the notifications of the account: sign-ins and
	// their end.
	onAccount func(method string, params json.RawMessage)
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

func startServer(ctx context.Context, path string, env []string, log *slog.Logger, onIdle func(*server), onAccount func(string, json.RawMessage)) (*server, error) {
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
	s := &server{log: log, cmd: cmd, stdin: stdin, onIdle: onIdle, onAccount: onAccount, pending: map[int]chan response{}, sessions: map[string]*session{}, exited: make(chan struct{})}
	cmd.Stderr = io.MultiWriter(&s.stderr, &agent.LineLog{Log: log})
	if err := cmd.Start(); err != nil {
		log.Warn("app-server did not start", "error", err.Error())
		return nil, fmt.Errorf("%w: %w", agent.ErrStartFailed, err)
	}
	s.log = log.With("pid", cmd.Process.Pid)
	s.log.Info("app-server started")
	go s.read(stdout)
	init := map[string]any{"clientInfo": map[string]any{"name": "aibo", "version": "0.1"}, "capabilities": map[string]any{"experimentalApi": true}}
	var hello struct {
		UserAgent string `json:"userAgent"`
	}
	if err := s.call(ctx, "initialize", init, &hello); err != nil {
		s.kill()
		return nil, fmt.Errorf("%w: initialize: %w", agent.ErrStartFailed, err)
	}
	product, _, _ := strings.Cut(hello.UserAgent, " ")
	_, s.version, _ = strings.Cut(product, "/")
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
		return fmt.Errorf("%w: the app-server exited", agent.ErrClosed)
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
		return fmt.Errorf("the Codex app-server did not answer %s", method)
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
			s.request(*m.ID, m.Method, m.Params)
		default:
			s.notify(m.Method, m.Params)
		}
	}
	err := s.cmd.Wait()
	exit := "ok"
	if err != nil {
		exit = err.Error()
	}
	s.log.Info("app-server exited", "exit", exit)
	s.mu.Lock()
	s.dead = true
	sessions := s.sessions
	s.sessions = map[string]*session{}
	for id, ch := range s.pending {
		ch <- response{err: fmt.Errorf("%w: the app-server exited", agent.ErrClosed)}
		delete(s.pending, id)
	}
	s.mu.Unlock()
	close(s.exited)
	s.onIdle(s)
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	if t := strings.TrimSpace(s.stderr.String()); t != "" {
		msg = strings.TrimSpace(msg + "\n" + t)
	}
	for _, sess := range sessions {
		sess.ended(msg)
	}
}

// request passes an approval request to the session of its thread;
// those aibo does not ask the user about are declined.
func (s *server) request(id json.RawMessage, method string, params json.RawMessage) {
	var p struct {
		ThreadID string `json:"threadId"`
	}
	json.Unmarshal(params, &p)
	s.mu.Lock()
	sess := s.sessions[p.ThreadID]
	s.mu.Unlock()
	if sess != nil && sess.ask(id, method, params) {
		return
	}
	s.log.Warn("unknown request", "method", method, "fields", agent.Shape(params))
	s.send(map[string]any{"id": id, "error": map[string]any{"code": -32601, "message": "aibo does not support " + method}})
}

// notify passes a notification to the session of its thread, and those
// of the account to the Agent.
func (s *server) notify(method string, params json.RawMessage) {
	s.logNotice(method, params)
	if strings.HasPrefix(method, "account/") && s.onAccount != nil {
		s.onAccount(method, params)
		return
	}
	if method == "skills/changed" {
		s.skillsChanged()
		return
	}
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
	// asks are the approval requests waiting for an answer, by ID.
	asks map[string]ask
	// note is what the user said denying a request, which Codex's answer
	// cannot carry: it goes with the next message.
	note string
	// rules are the session's rules, which Codex forgot when the thread
	// started again: aibo answers what they allow.
	rules []agent.Rule
	// mode, model and effort, when set, apply from the next turn.
	mode, model, effort string
	// cwd is the workspace; start the thread's thread/start params, and
	// current the settings since, which a new thread ("/clear") takes.
	cwd     string
	start   map[string]any
	current settings
}

// ask passes an approval request to the user; ok is false for requests
// that are not approvals the user answers.
func (s *session) ask(rpcID json.RawMessage, method string, params json.RawMessage) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	id := "codex-" + string(rpcID)
	a, k, ok := s.parse.approval(id, method, params)
	if !ok {
		return false
	}
	k.rpcID = rpcID
	if allowed(s.rules, a, method) {
		// Answered for the session again, so that Codex remembers too.
		go s.srv.send(map[string]any{"id": rpcID, "result": map[string]any{"decision": "acceptForSession"}})
		return true
	}
	if s.asks == nil {
		s.asks = map[string]ask{}
	}
	s.asks[id] = k
	s.events <- a
	return true
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
		switch e.(type) {
		case agent.TurnEnded:
			s.running, s.turn = false, ""
			clear(s.asks)
		case agent.NotLoggedIn:
			go s.Interrupt(context.Background())
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
		err := agent.ErrClosed
		if s.running {
			err = agent.ErrBusy
		}
		s.mu.Unlock()
		return err
	}
	s.running = true
	if turn.Command != nil && turn.Command.Handling == agent.ByReset {
		s.mu.Unlock()
		go s.reset()
		return nil
	}
	var method string
	var params map[string]any
	if isReview(turn.Command) {
		// It takes no settings, nor a note: they wait for the next turn.
		method, params = "review/start", reviewParams(s.id, withFiles(turn.Text, turn.Files))
	} else {
		text := commandText(turn)
		if s.note != "" {
			// Codex's decline carries no reason: it comes now.
			text = denyNote(s.note) + text
			s.note = ""
		}
		method, params = "turn/start", s.turnParams(withFiles(text, turn.Files), turn.Images)
		if item, ok := skillInput(turn.Command); ok {
			params["input"] = append(params["input"].([]any), item)
		}
	}
	s.mu.Unlock()
	var res struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	err := s.srv.call(ctx, method, params, &res)
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

func (s *session) RespondApproval(_ context.Context, id, optionID, note string) error {
	s.mu.Lock()
	k, ok := s.asks[id]
	if !ok {
		s.mu.Unlock()
		return errors.New("no such approval request pending")
	}
	result, err := k.result(optionID)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	delete(s.asks, id)
	if note != "" && (optionID == "decline" || optionID == "cancel") {
		s.note = note
	}
	s.mu.Unlock()
	return s.srv.send(map[string]any{"id": k.rpcID, "result": result})
}

// Compact runs thread/compact/start: a turn of its own, with a
// contextCompaction item.
func (s *session) Compact(ctx context.Context) error {
	s.mu.Lock()
	if s.closed || s.running {
		s.mu.Unlock()
		return agent.ErrBusy
	}
	s.running, s.parse.compacting = true, true
	s.mu.Unlock()
	if err := s.srv.call(ctx, "thread/compact/start", map[string]any{"threadId": s.id}, nil); err != nil {
		s.mu.Lock()
		s.running, s.parse.compacting = false, false
		s.mu.Unlock()
		return err
	}
	return nil
}

// AccountEvent is news of the account: a sign-in that ended (LoginID
// set), or a change of how Codex is signed in.
type AccountEvent struct {
	LoginID string
	Success bool
	Error   string
}

// OnAccount calls fn, from any goroutine, with the account's news.
func (a *Agent) OnAccount(fn func(AccountEvent)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.onAccount = fn
}

func (a *Agent) account(method string, params json.RawMessage) {
	a.mu.Lock()
	fn := a.onAccount
	a.mu.Unlock()
	if fn == nil {
		return
	}
	switch method {
	case "account/login/completed":
		var p struct {
			LoginID string  `json:"loginId"`
			Success bool    `json:"success"`
			Error   *string `json:"error"`
		}
		json.Unmarshal(params, &p)
		e := AccountEvent{LoginID: p.LoginID, Success: p.Success}
		if p.Error != nil {
			e.Error = *p.Error
		}
		fn(e)
	case "account/updated":
		fn(AccountEvent{})
	}
}

// Login is a sign-in started in aibo: in the browser at AuthURL, or with
// UserCode at VerificationURL.
type Login struct {
	ID              string `json:"loginId"`
	AuthURL         string `json:"authUrl"`
	VerificationURL string `json:"verificationUrl"`
	UserCode        string `json:"userCode"`
}

// Login starts signing in with ChatGPT: in the browser, or with a device
// code when deviceCode. Codex keeps the credentials; aibo never sees
// them. Its end comes to OnAccount.
func (a *Agent) Login(ctx context.Context, deviceCode bool) (Login, error) {
	srv, err := a.server(ctx)
	if err != nil {
		return Login{}, err
	}
	kind := "chatgpt"
	if deviceCode {
		kind = "chatgptDeviceCode"
	}
	var l Login
	err = srv.call(ctx, "account/login/start", map[string]any{"type": kind}, &l)
	return l, err
}

// CancelLogin cancels a sign-in started.
func (a *Agent) CancelLogin(ctx context.Context, id string) error {
	srv, err := a.server(ctx)
	if err != nil {
		return err
	}
	return srv.call(ctx, "account/login/cancel", map[string]any{"loginId": id}, nil)
}
