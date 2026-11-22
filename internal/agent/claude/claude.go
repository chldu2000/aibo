// Package claude is the Agent adapter of Claude Code: a long-running
// `claude -p` per session, speaking stream-json over stdin and stdout.
//
// It only runs the user's own, unmodified claude, and never reads or
// passes on the credentials in ~/.claude: Claude Code signs in by itself.
package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
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
	mode, allowed, dirs := ruleArgs(opts.Level, opts.Rules)
	dirs = append(dirs, opts.ReadDirs...)
	// Other workspaces it may read, not change: Claude Code denies Edit
	// and Write there, and the shell's writes too, whatever the level.
	var denied []string
	for _, d := range opts.ReadDirs {
		for _, p := range samePlaces(d) {
			denied = append(denied, "Edit(/"+p+"/**)", "Write(/"+p+"/**)")
		}
	}
	// The option lets the level rise to full auto later in the session.
	args = append(args, "--permission-mode", mode, "--allow-dangerously-skip-permissions")
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
	path, env := a.path, a.env
	a.mu.Unlock()
	if path == "" {
		return nil, errors.New("没有找到 Claude Code")
	}
	cmd := exec.Command(path, a.args(opts)...)
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
	cmd.Stderr = &s.stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 Claude Code 失败：%w", err)
	}
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
		why = "没有回应"
	}
	if opts.ResumeID != "" {
		return nil, fmt.Errorf("%w：%s", agent.ErrResumeFailed, why)
	}
	return nil, fmt.Errorf("Claude Code 启动失败：%s", why)
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
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		return errors.New("Claude Code 会话已关闭")
	}
	if s.running {
		return errors.New("Claude Code 正在回复")
	}
	s.running = true
	err := s.write(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": turn.Text}})
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
				} `json:"response"`
			}
			json.Unmarshal(sc.Bytes(), &e)
			switch {
			case e.Type == "control_response" && e.Response.RequestID == "init":
				started = true
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
	s.running = false
	s.mu.Unlock()
	if running {
		if !closing {
			msg := "Claude Code 进程意外退出"
			if err != nil {
				msg += "（" + err.Error() + "）"
			}
			if t := strings.TrimSpace(s.stderr.String()); t != "" {
				msg += "：" + t
			}
			s.events <- agent.Failed{Message: msg}
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
		return errors.New("Claude Code 没有在等这个审批")
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

// SetLevel switches the permission mode of the running session.
func (s *session) SetLevel(_ context.Context, level agent.ApprovalLevel) error {
	mode, ok := modes[level]
	if !ok {
		return fmt.Errorf("没有这个审批档位：%s", level)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextReq++
	return s.write(map[string]any{"type": "control_request", "request_id": fmt.Sprintf("mode-%d", s.nextReq),
		"request": map[string]any{"subtype": "set_permission_mode", "mode": mode}})
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
		return nil, errors.New("没有找到 Claude Code")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose")
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
	return nil, errors.New("Claude Code 没有说它有哪些模型")
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
