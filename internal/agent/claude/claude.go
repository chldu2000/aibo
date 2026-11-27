// Package claude is the Agent adapter of Claude Code: a long-running
// `claude -p` per session, speaking stream-json over stdin and stdout.
//
// It only runs the user's own, unmodified claude, and never reads or
// passes on the credentials in ~/.claude: Claude Code signs in by itself.
package claude

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/proc"
)

// Kind is Claude Code's kind.
const Kind agent.Kind = "claude"

// Agent runs Claude Code.
type Agent struct {
	mu sync.Mutex
	// path is the claude executable; env is added to the environment of
	// its processes.
	path string
	env  []string
	log  *slog.Logger
}

// SetLog sets the diagnostic log of the sessions to come.
func (a *Agent) SetLog(log *slog.Logger) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.log = log
}

// Configure sets the executable and the environment its sessions start
// with from then on.
func (a *Agent) Configure(path string, env []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.path, a.env = path, env
}

// New returns the Agent running the claude at path.
func New(path string) *Agent { return &Agent{path: path} }

func (a *Agent) Kind() agent.Kind { return Kind }
func (a *Agent) Name() string     { return "Claude Code" }

// ToolName is how Claude names an MCP server's tool: mcp__<server>__<tool>.
func (a *Agent) ToolName(tool string) string { return "mcp__aibo__" + tool }

// args are the command line of a session.
func (a *Agent) args(opts agent.StartOptions) []string {
	args := []string{"-p",
		"--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
		"--include-partial-messages", "--forward-subagent-text",
		// Approvals come as can_use_tool control requests.
		"--permission-prompt-tool", "stdio",
	}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	// Resumed, Claude Code forgets the effort: it goes again each time.
	if opts.Effort != "" {
		args = append(args, "--effort", opts.Effort)
	}
	if opts.ResumeID != "" {
		args = append(args, "--resume", opts.ResumeID)
	}
	mode, allowed, dirs := ruleArgs(opts.Mode, opts.Rules)
	dirs = append(dirs, opts.ReadDirs...)
	// Other workspaces it may read, not change: Claude Code denies Edit
	// and Write there, and the shell's writes too, whatever the level.
	var denied []string
	for _, d := range opts.ReadDirs {
		for _, p := range samePlaces(d) {
			denied = append(denied, "Edit(/"+p+"/**)", "Write(/"+p+"/**)")
		}
	}
	if mode != "" {
		args = append(args, "--permission-mode", mode)
	}
	// The option lets the mode go to bypassPermissions later in the
	// session.
	args = append(args, "--allow-dangerously-skip-permissions")
	if len(dirs) > 0 {
		args = append(append(args, "--add-dir"), dirs...)
	}
	if opts.MCP != nil {
		allowed = append([]string{"mcp__aibo__*"}, allowed...)
		// Only the workbench's server, its token read from the process's
		// environment (tokenVar) so that it is not on the command line,
		// and its tools need no approval.
		cfg, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{"aibo": map[string]any{
			"type":    "http",
			"url":     opts.MCP.URL,
			"headers": map[string]string{"Authorization": "Bearer ${" + tokenVar + "}"},
		}}})
		args = append(args, "--mcp-config", string(cfg), "--strict-mcp-config")
	}
	if len(allowed) > 0 {
		args = append(append(args, "--allowedTools"), allowed...)
	}
	if len(denied) > 0 {
		args = append(append(args, "--disallowedTools"), denied...)
	}
	return args
}

// tokenVar is the environment variable that holds the session's token
// for the workbench MCP server.
const tokenVar = "AIBO_MCP_TOKEN"

func (a *Agent) Start(ctx context.Context, opts agent.StartOptions) (agent.Session, error) {
	a.mu.Lock()
	path, env, log := a.path, a.env, a.log
	a.mu.Unlock()
	if log == nil {
		log = agent.Discard
	}
	if path == "" {
		return nil, agent.ErrNotFound
	}
	cmd := exec.Command(path, a.args(opts)...)
	proc.Hide(cmd)
	cmd.Dir = opts.Workspace
	cmd.Env = append(os.Environ(), env...)
	if opts.MCP != nil {
		cmd.Env = append(cmd.Env, tokenVar+"="+opts.MCP.Token)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	s := &session{cmd: cmd, stdin: stdin, events: make(chan agent.Event, 256), parser: newParser(), exited: make(chan struct{}), ready: make(chan struct{})}
	s.parser.log = log
	cmd.Stderr = io.MultiWriter(&s.stderr, &agent.LineLog{Log: log})
	if err := cmd.Start(); err != nil {
		log.Warn("process did not start", "error", err.Error())
		return nil, fmt.Errorf("%w: %w", agent.ErrStartFailed, err)
	}
	s.log = log.With("pid", cmd.Process.Pid)
	s.log.Info("process started", "resume", opts.ResumeID != "", "model", opts.Model, "mode", opts.Mode)
	go s.read(stdout)
	// The control protocol starts with initialize, which Claude Code
	// answers once the session is ready: a session it cannot resume ends
	// first, with the reason on stderr.
	if err := s.write(map[string]any{"type": "control_request", "request_id": "init", "request": map[string]any{"subtype": "initialize", "hooks": nil}}); err != nil {
		s.Close()
		return nil, err
	}
	select {
	case <-s.ready:
		// What it uses, which the options may not say: its default.
		if err := s.control("settings", map[string]any{"subtype": "get_settings"}); err != nil {
			s.Close()
			return nil, err
		}
		return s, nil
	case <-s.exited:
	case <-ctx.Done():
		s.cmd.Process.Kill()
		<-s.exited
		return nil, ctx.Err()
	case <-time.After(startTimeout):
		s.cmd.Process.Kill()
		<-s.exited
	}
	why := strings.TrimSpace(s.stderr.String())
	if why == "" {
		why = s.startErr
	}
	if why == "" {
		why = "no answer"
	}
	if opts.ResumeID != "" {
		return nil, fmt.Errorf("%w: %s", agent.ErrResumeFailed, why)
	}
	return nil, fmt.Errorf("%w: %s", agent.ErrStartFailed, why)
}

// startTimeout is how long Claude Code may take to be ready.
const startTimeout = time.Minute

type session struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	events chan agent.Event
	stderr tail
	exited chan struct{}
	// ready is closed when Claude Code answered initialize; startErr is
	// what it reported before, failing to start.
	ready    chan struct{}
	startErr string

	log *slog.Logger

	mu      sync.Mutex
	parser  *parser
	running bool
	closing bool
	nextReq int
}

func (s *session) Events() <-chan agent.Event { return s.events }

func (s *session) write(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.stdin.Write(append(b, '\n'))
	return err
}

func (s *session) Send(_ context.Context, turn agent.Turn) error {
	content, err := turnContent(turn)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		return agent.ErrClosed
	}
	if s.running {
		return agent.ErrBusy
	}
	s.running = true
	err = s.write(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": content}})
	if err != nil {
		s.running = false
	}
	return err
}

func (s *session) Interrupt(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running || s.parser.interrupting {
		return nil
	}
	s.parser.interrupting = true
	s.nextReq++
	return s.write(map[string]any{"type": "control_request", "request_id": fmt.Sprintf("interrupt-%d", s.nextReq), "request": map[string]any{"subtype": "interrupt"}})
}

// Close ends the process: stdin closed, it ends by itself, or is killed
// after a while.
func (s *session) Close() error {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		<-s.exited
		return nil
	}
	s.closing = true
	if s.running {
		s.parser.interrupting = true
	}
	s.mu.Unlock()
	s.stdin.Close()
	select {
	case <-s.exited:
	case <-time.After(5 * time.Second):
		s.cmd.Process.Kill()
		<-s.exited
	}
	return nil
}

// read turns the process's output into events until it ends.
func (s *session) read(stdout io.Reader) {
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 64<<20) // tool results come in one line
	started := false
	for sc.Scan() {
		if !started {
			var e struct {
				Type     string `json:"type"`
				Errors   []string
				Response struct {
					RequestID string `json:"request_id"`
					Response  struct {
						Mode string `json:"current_permission_mode"`
					} `json:"response"`
				} `json:"response"`
			}
			json.Unmarshal(sc.Bytes(), &e)
			switch {
			case e.Type == "control_response" && e.Response.RequestID == "init":
				started = true
				if m := e.Response.Response.Mode; m != "" {
					s.events <- agent.ModeReported{ID: m}
				}
				if cmds, ok := initCommands(sc.Bytes()); ok {
					s.events <- agent.CommandsChanged{Commands: cmds}
				}
				close(s.ready)
			case e.Type == "result":
				s.startErr = strings.Join(e.Errors, "\n")
			}
			continue
		}
		s.mu.Lock()
		evs := s.parser.line(sc.Bytes())
		for _, e := range evs {
			if _, ok := e.(agent.TurnEnded); ok {
				s.running = false
			}
		}
		s.mu.Unlock()
		for _, e := range evs {
			s.events <- e
		}
	}
	err := s.cmd.Wait()
	s.mu.Lock()
	running, closing := s.running, s.closing
	exit := "ok"
	if err != nil {
		exit = err.Error()
	}
	s.log.Info("process exited", "exit", exit, "closing", closing, "during_turn", running)
	s.running = false
	s.mu.Unlock()
	if running {
		if !closing {
			msg := ""
			if err != nil {
				msg = err.Error()
			}
			if t := strings.TrimSpace(s.stderr.String()); t != "" {
				msg = strings.TrimSpace(msg + "\n" + t)
			}
			s.events <- agent.Failed{Message: msg, Exited: true}
		}
		s.events <- agent.TurnEnded{Interrupted: true}
	}
	close(s.events)
	close(s.exited)
}

// tail keeps the last few KB written to it: a process's stderr.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

const tailLen = 4096

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > tailLen {
		t.buf = t.buf[len(t.buf)-tailLen:]
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
	defer s.mu.Unlock()
	r, ok := s.parser.asks[id]
	if !ok {
		return errors.New("no such approval request pending")
	}
	resp, err := response(r, optionID, note)
	if err != nil {
		return err
	}
	delete(s.parser.asks, id)
	if optionID == optStop {
		s.parser.interrupting = true
	}
	return s.write(map[string]any{"type": "control_response", "response": map[string]any{"subtype": "success", "request_id": id, "response": resp}})
}

// SetMode switches the permission mode of the running session, which
// Claude Code reports with its next turn (system/init).
func (s *session) SetMode(_ context.Context, mode string) error {
	if !knownMode(mode) {
		return fmt.Errorf("no such permission mode: %s", mode)
	}
	return s.control("mode", map[string]any{"subtype": "set_permission_mode", "mode": mode})
}

// PermissionModes are Claude Code's own (Modes).
func (a *Agent) PermissionModes(context.Context) ([]agent.PermissionMode, error) {
	return append([]agent.PermissionMode(nil), Modes...), nil
}

// settingsReq starts the IDs of get_settings requests, whose answers say
// what the session uses (agent.SettingsReported).
const settingsReq = "settings-"

// control sends a control request whose ID starts with prefix.
func (s *session) control(prefix string, request map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextReq++
	return s.write(map[string]any{"type": "control_request", "request_id": fmt.Sprintf("%s-%d", prefix, s.nextReq), "request": request})
}

// SetModel switches the model (set_model; "default" is Claude Code's own)
// and the effort (apply_flag_settings; null is its default), then asks
// what it uses now (get_settings).
func (s *session) SetModel(_ context.Context, model, effort string) error {
	if model == "" {
		model = "default"
	}
	var level any
	if effort != "" {
		level = effort
	}
	if err := s.control("model", map[string]any{"subtype": "set_model", "model": model}); err != nil {
		return err
	}
	if err := s.control("effort", map[string]any{"subtype": "apply_flag_settings", "settings": map[string]any{"effortLevel": level}}); err != nil {
		return err
	}
	return s.control("settings", map[string]any{"subtype": "get_settings"})
}

// turnContent is a user message's content: its text, or, with images,
// an image block for each (base64, as Claude Code takes them: research/17)
// before the text.
func turnContent(turn agent.Turn) (any, error) {
	text := withFiles(turn)
	if len(turn.Images) == 0 {
		return text, nil
	}
	var blocks []any
	for _, img := range turn.Images {
		b, err := os.ReadFile(img.Path)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": img.MIME, "data": base64.StdEncoding.EncodeToString(b)}})
	}
	// An empty text block is refused.
	if text != "" {
		blocks = append(blocks, map[string]any{"type": "text", "text": text})
	}
	return blocks, nil
}

// withFiles is a turn's text, after the command it invokes, with its
// files after it, as Claude Code reads them itself: @path, quoted when it
// has a space (research/07).
func withFiles(turn agent.Turn) string {
	text := commandText(turn)
	if len(turn.Files) == 0 {
		return text
	}
	var b strings.Builder
	b.WriteString(text)
	// Each on a line of its own: Claude Code reads an @ only after a
	// space or at the start of a line, not after "：".
	b.WriteString("\n\n" + filesHeading)
	for _, f := range turn.Files {
		b.WriteString("\n")
		name := f.Name()
		if strings.ContainsAny(name, " \t\"") {
			name = `"` + strings.ReplaceAll(name, `"`, `\"`) + `"`
		}
		b.WriteString("@" + name)
	}
	return strings.TrimSpace(b.String())
}

// Compact sends /compact, which Claude Code runs as a turn reporting
// compact_boundary.
func (s *session) Compact(ctx context.Context) error {
	return s.Send(ctx, agent.Turn{Text: "/compact"})
}

// Models asks Claude Code which models it offers: initialize answers
// with them, before any turn. Its "default" is the empty ID.
func (a *Agent) Models(ctx context.Context) ([]agent.Model, error) {
	a.mu.Lock()
	path, env := a.path, a.env
	a.mu.Unlock()
	if path == "" {
		return nil, agent.ErrNotFound
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose")
	proc.Hide(cmd)
	cmd.Dir = os.TempDir()
	cmd.Env = append(os.Environ(), env...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() {
		stdin.Close()
		cmd.Process.Kill()
		cmd.Wait()
	}()
	b, _ := json.Marshal(map[string]any{"type": "control_request", "request_id": "models", "request": map[string]any{"subtype": "initialize"}})
	if _, err := stdin.Write(append(b, '\n')); err != nil {
		return nil, err
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 16<<20)
	for sc.Scan() {
		if out, ok := models(sc.Bytes()); ok {
			return out, nil
		}
	}
	return nil, errors.New("Claude Code did not tell its models")
}

// models reads initialize's answer, if line is it: its models, its
// "default" as the empty ID, each with the efforts it takes.
func models(line []byte) ([]agent.Model, bool) {
	var e struct {
		Type     string `json:"type"`
		Response struct {
			RequestID string `json:"request_id"`
			Response  struct {
				Models []struct {
					Value          string   `json:"value"`
					Resolved       string   `json:"resolvedModel"`
					DisplayName    string   `json:"displayName"`
					Description    string   `json:"description"`
					SupportsEffort bool     `json:"supportsEffort"`
					Efforts        []string `json:"supportedEffortLevels"`
				} `json:"models"`
			} `json:"response"`
		} `json:"response"`
	}
	if json.Unmarshal(line, &e) != nil || e.Type != "control_response" || e.Response.RequestID != "models" {
		return nil, false
	}
	var out []agent.Model
	for _, m := range e.Response.Response.Models {
		x := agent.Model{ID: m.Value, Name: m.DisplayName, Description: m.Description, Resolved: m.Resolved}
		if x.ID == "default" {
			x.ID = ""
		}
		if m.SupportsEffort {
			x.Efforts = m.Efforts
		}
		out = append(out, x)
	}
	return out, true
}

// DirsAtStart: Claude Code takes --add-dir only as it starts.
func (a *Agent) DirsAtStart() bool { return true }

// samePlaces are a directory's path and, when a symbolic link leads
// elsewhere (/tmp is /private/tmp), the path it resolves to: a rule must
// name the one Claude Code sees.
func samePlaces(dir string) []string {
	dir = filepath.Clean(dir)
	out := []string{dir}
	if r, err := filepath.EvalSymlinks(dir); err == nil && r != dir {
		out = append(out, r)
	}
	return out
}
