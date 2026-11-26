package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strconv"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

type object map[string]any
type envelope struct {
	ID             json.RawMessage
	Method         string
	Params, Result json.RawMessage
	Error          *struct {
		Code    int
		Message string
	}
}
type request struct {
	receive func(json.RawMessage) error
	result  chan error
}
type session struct {
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	stdout         io.ReadCloser
	log            *slog.Logger
	events         chan agent.Event
	stopping, done chan struct{}
	closeOnce      sync.Once
	writeLock      chan struct{}
	control        sync.Mutex // serialize outgoing turns, answers and cancellation

	// clientMeta is what the handshake tells the Agent in
	// clientCapabilities._meta (Agent.SetClientMeta).
	clientMeta map[string]any

	// The reader sets id during the handshake, before Start returns.
	id                        string
	image                     bool
	mu                        sync.Mutex
	next, active              int
	cancelling                bool
	requests                  map[int]request
	pending                   map[string]permission
	options                   []configOption
	modes                     *legacyModes
	defaultModel, defaultMode string
	// preferMode is the configuration's default mode (ModeTag), which an
	// empty mode asks for in place of the Agent's own when it offers it.
	preferMode string
	// learn passes the settings a session sees to its Agent (Agent.learn).
	learn func(opts []configOption, modes *legacyModes, fresh bool)

	// Only the reader handles streamed messages and tool state.
	reply string
	// unnamed is set while reply is one aibo named, the Agent giving its
	// chunks no messageId; segment counts the tool calls and plans that
	// end such a reply, the text after them being another.
	unnamed  bool
	segment  int
	tools    map[string]bool
	declined map[string]bool
}

func launch(cmd *exec.Cmd, log *slog.Logger) (*session, error) {
	in, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return nil, err
	}
	// Third-party stderr can include complete requests or credentials.
	if err = cmd.Start(); err != nil {
		in.Close()
		out.Close()
		return nil, err
	}
	s := &session{
		cmd: cmd, stdin: in, stdout: out, log: log.With("pid", cmd.Process.Pid),
		events: make(chan agent.Event, 128), stopping: make(chan struct{}), done: make(chan struct{}),
		writeLock: make(chan struct{}, 1), requests: map[int]request{},
		pending: map[string]permission{}, tools: map[string]bool{}, declined: map[string]bool{},
	}
	s.log.Info("ACP process started")
	go s.read()
	return s, nil
}

func (s *session) emit(ev agent.Event) {
	select {
	case s.events <- ev:
	case <-s.stopping:
	}
}
func (s *session) Close() error {
	s.closeOnce.Do(func() {
		close(s.stopping)
		timer := time.AfterFunc(time.Second, func() {
			s.cmd.Cancel()
			s.stdout.Close()
		})
		defer timer.Stop()
		s.stdin.Close()
		<-s.done
	})
	return nil
}

// Bound a blocked pipe even when a caller supplied no deadline. Killing the
// private process on a partial write keeps a later request off a broken stream.
func (s *session) write(ctx context.Context, msg object) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	select {
	case <-s.done:
		return agent.ErrClosed
	case <-s.stopping:
		return agent.ErrClosed
	case <-ctx.Done():
		return ctx.Err()
	case s.writeLock <- struct{}{}:
	}
	defer func() { <-s.writeLock }()
	if err := ctx.Err(); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { s.cmd.Cancel() })
	defer stop()
	msg["jsonrpc"] = "2.0"
	return json.NewEncoder(s.stdin).Encode(msg)
}

// call sends a request and waits for its answer: until ctx is done, or for
// 45 seconds when ctx has no deadline of its own (Start's, a probe's).
func (s *session) call(ctx context.Context, method string, params object, receive func(json.RawMessage) error) error {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
	}
	r := request{receive: receive, result: make(chan error, 1)}
	s.mu.Lock()
	s.next++
	id := s.next
	s.requests[id] = r
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.requests, id); s.mu.Unlock() }()
	if err := s.write(ctx, object{"id": id, "method": method, "params": params}); err != nil {
		return err
	}
	select {
	case err := <-r.result:
		return err
	case <-s.done:
		return agent.ErrClosed
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *session) prompt(ctx context.Context, blocks []object) error {
	s.control.Lock()
	defer s.control.Unlock()
	s.mu.Lock()
	if s.active != 0 {
		s.mu.Unlock()
		return agent.ErrBusy
	}
	s.next++
	id := s.next
	s.active = id
	s.mu.Unlock()
	err := s.write(ctx, object{"id": id, "method": "session/prompt", "params": object{"sessionId": s.id, "prompt": blocks}})
	if err != nil {
		s.mu.Lock()
		if s.active == id {
			s.active = 0
		}
		s.mu.Unlock()
	}
	return err
}
func (s *session) read() {
	defer close(s.done)
	defer close(s.events)
	sc := bufio.NewScanner(s.stdout)
	sc.Buffer(make([]byte, 65536), 32<<20)
	var err error
	for sc.Scan() {
		var m envelope
		if err = json.Unmarshal(sc.Bytes(), &m); err != nil {
			break
		}
		if m.Method != "" {
			s.incoming(m)
		} else {
			s.response(m)
		}
	}
	if err == nil {
		err = sc.Err()
	}
	// EOF with an open process (or invalid output) must also release Wait.
	if err != nil {
		s.cmd.Cancel()
	}
	timer := time.AfterFunc(time.Second, func() { s.cmd.Cancel() })
	if exitErr := s.cmd.Wait(); err == nil {
		err = exitErr
	}
	timer.Stop()
	s.log.Info("ACP process ended")
	select {
	case <-s.stopping:
		return
	default:
	}
	message := "ACP agent closed its output"
	if err != nil {
		message = fmt.Sprintf("%s: %s", message, err)
	}
	s.emit(agent.Failed{Message: message, Exited: true})
	s.mu.Lock()
	active := s.active != 0
	s.active = 0
	clear(s.pending)
	s.mu.Unlock()
	if active {
		s.emit(agent.TurnEnded{Interrupted: true})
	}
}
func (s *session) response(m envelope) {
	id, err := strconv.Atoi(string(m.ID))
	if err != nil || id < 1 {
		return
	}
	s.mu.Lock()
	r, ok := s.requests[id]
	active := s.active
	s.mu.Unlock()
	if m.Error != nil {
		err = fmt.Errorf("ACP %d: %s", m.Error.Code, m.Error.Message)
	}
	if ok {
		if err == nil && r.receive != nil {
			err = r.receive(m.Result)
		}
		if m.Error != nil && m.Error.Code == -32000 { // ACP's auth_required
			r.result <- fmt.Errorf("%w: %w", agent.ErrNotLoggedIn, err)
		} else {
			r.result <- err
		}
		s.mu.Lock()
		delete(s.requests, id)
		s.mu.Unlock()
		return
	}
	if id != active {
		s.log.Debug("unexpected ACP response")
		return
	}
	var end struct{ StopReason string }
	if err == nil {
		err = json.Unmarshal(m.Result, &end)
		if err == nil && end.StopReason == "" {
			err = errors.New("missing ACP stopReason")
		}
	}
	interrupted := end.StopReason == "cancelled" || err != nil
	if interrupted {
		// TurnEnded marks an unfinished reply interrupted in the workbench.
		s.reply, s.unnamed = "", false
	} else {
		s.finishReply()
	}
	if err != nil {
		if m.Error != nil && m.Error.Code == -32000 {
			s.emit(agent.NotLoggedIn{})
		}
		s.emit(agent.Failed{Message: err.Error()})
	}
	clear(s.tools)
	s.mu.Lock()
	s.active = 0
	s.cancelling = false
	clear(s.pending)
	clear(s.declined)
	s.mu.Unlock()
	s.emit(agent.TurnEnded{Interrupted: interrupted})
}
func (s *session) incoming(m envelope) {
	var p struct {
		SessionID string
		Update    json.RawMessage
	}
	valid := json.Unmarshal(m.Params, &p) == nil && p.SessionID == s.id && s.id != ""
	s.mu.Lock()
	active := s.active
	s.mu.Unlock()
	if len(m.ID) > 0 {
		if m.Method == "session/request_permission" {
			if valid && active != 0 {
				s.permission(m)
			} else {
				s.answer(m.ID, "")
			}
			return
		}
		s.log.Debug("unsupported ACP request", "method", m.Method)
		s.write(context.Background(), object{"id": m.ID, "error": object{"code": -32601, "message": "method not supported"}})
		return
	}
	if m.Method != "session/update" {
		s.log.Debug("unknown ACP notification", "method", m.Method)
		return
	}
	// session/load can replay all history before its reply. The workbench
	// already owns that timeline. Other session IDs cannot affect this one.
	if valid {
		s.update(p.Update, active)
	}
}
