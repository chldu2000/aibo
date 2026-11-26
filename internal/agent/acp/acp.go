// Package acp drives local Agent Client Protocol v1 executables over stdio.
// Each native session owns a process, including when resuming in the same workspace.
package acp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

type Agent struct {
	kind   agent.Kind
	name   string
	args   []string
	prefix string
	mu     sync.Mutex
	path   string
	env    []string
	log    *slog.Logger
}

func New(kind agent.Kind, name, command string, args []string, toolPrefix string) *Agent {
	return &Agent{kind: kind, name: name, path: command, args: slices.Clone(args), prefix: toolPrefix, log: agent.Discard}
}
func (a *Agent) Kind() agent.Kind { return a.kind }
func (a *Agent) Name() string     { return a.name }
func (a *Agent) ToolName(tool string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.prefix + tool
}

func (a *Agent) SetToolPrefix(prefix string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prefix = prefix
}
func (a *Agent) SupportsReadDirs() bool   { return false }
func (a *Agent) SupportsCompaction() bool { return false }
func (a *Agent) Configure(path string, env []string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.path, a.env = path, slices.Clone(env)
}
func (a *Agent) SetLog(log *slog.Logger) { a.mu.Lock(); defer a.mu.Unlock(); a.log = log }

type capabilities struct {
	LoadSession         bool
	MCPCapabilities     struct{ HTTP bool }
	PromptCapabilities  struct{ Image bool }
	SessionCapabilities struct{ Resume *struct{} }
}

type configOption struct {
	ID, Category string
	CurrentValue json.RawMessage
}
type sessionInfo struct {
	SessionID     string
	ConfigOptions []configOption
}

func (a *Agent) Start(ctx context.Context, o agent.StartOptions) (agent.Session, error) {
	a.mu.Lock()
	path, env, log := a.path, a.env, a.log
	a.mu.Unlock()
	if path == "" {
		return nil, agent.ErrNotFound
	}
	// The caller's Start deadline applies to negotiation. The session owns
	// the process after Start returns.
	cmd := exec.CommandContext(context.Background(), path, a.args...)
	agent.BoundProcess(cmd)
	cmd.Dir = o.Workspace
	cmd.Env = append(os.Environ(), env...)
	s, err := launch(cmd, log)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", agent.ErrStartFailed, err)
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if err = s.initialize(ctx, o); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

func (s *session) initialize(ctx context.Context, o agent.StartOptions) error {
	var hello struct {
		ProtocolVersion   int
		AgentCapabilities capabilities
	}
	err := s.call(ctx, "initialize", object{"protocolVersion": 1, "clientCapabilities": object{}, "clientInfo": object{"name": "aibo", "version": "1"}}, func(raw json.RawMessage) error { return json.Unmarshal(raw, &hello) })
	if err != nil {
		return fmt.Errorf("%w: initialize: %w", agent.ErrStartFailed, err)
	}
	if hello.ProtocolVersion != 1 {
		return fmt.Errorf("%w: unsupported ACP version %d", agent.ErrStartFailed, hello.ProtocolVersion)
	}
	caps := hello.AgentCapabilities
	s.image = caps.PromptCapabilities.Image
	servers := []object{}
	if o.MCP != nil {
		if !caps.MCPCapabilities.HTTP {
			return fmt.Errorf("%w: agent does not support HTTP MCP", agent.ErrStartFailed)
		}
		servers = append(servers, object{"type": "http", "name": "aibo", "url": o.MCP.URL, "headers": []object{{"name": "Authorization", "value": "Bearer " + o.MCP.Token}}})
	}
	method, failure := "session/new", agent.ErrStartFailed
	params := object{"cwd": o.Workspace, "mcpServers": servers}
	if o.ResumeID != "" {
		failure = agent.ErrResumeFailed
		params["sessionId"] = o.ResumeID
		switch {
		case caps.SessionCapabilities.Resume != nil:
			method = "session/resume"
		case caps.LoadSession:
			method = "session/load"
		default:
			return fmt.Errorf("%w: ACP agent cannot resume or load sessions", failure)
		}
	}
	err = s.call(ctx, method, params, func(raw json.RawMessage) error {
		var info sessionInfo
		if err := json.Unmarshal(raw, &info); err != nil {
			return err
		}
		id := o.ResumeID
		if id == "" {
			id = info.SessionID
		}
		if id == "" {
			return errors.New("ACP agent returned an empty sessionId")
		}
		s.id = id
		s.emit(agent.NativeSessionStarted{ID: id})
		s.settings(info.ConfigOptions)
		return nil
	})
	if err != nil {
		return fmt.Errorf("%w: %s: %w", failure, method, err)
	}
	if o.Model != "" || o.Effort != "" {
		if err = s.SetModel(ctx, o.Model, o.Effort); err != nil {
			return fmt.Errorf("%w: %w", agent.ErrStartFailed, err)
		}
	}
	return nil
}

func (s *session) Events() <-chan agent.Event { return s.events }
func (s *session) Send(ctx context.Context, t agent.Turn) error {
	blocks := make([]object, 0, len(t.Images)+1)
	if len(t.Images) > 0 && !s.image {
		return errors.New("ACP agent does not accept image prompts")
	}
	for _, im := range t.Images {
		data, err := os.ReadFile(im.Path)
		if err != nil {
			return err
		}
		blocks = append(blocks, object{"type": "image", "mimeType": im.MIME, "data": base64.StdEncoding.EncodeToString(data)})
	}
	var msg strings.Builder
	msg.WriteString(t.Text)
	for _, f := range t.Files {
		msg.WriteString("\n")
		msg.WriteString(f.Name())
	}
	blocks = append(blocks, object{"type": "text", "text": msg.String()})
	return s.prompt(ctx, blocks)
}
func (s *session) SetMode(context.Context, string) error {
	return errors.New("ACP agent does not expose permission modes")
}
func (s *session) Compact(context.Context) error {
	return errors.New("ACP does not expose a compaction operation")
}
func (s *session) SetModel(ctx context.Context, model, effort string) error {
	s.mu.Lock()
	key, current, original, busy := s.modelKey, s.currentModel, s.defaultModel, s.active != 0
	s.mu.Unlock()
	if busy {
		return agent.ErrBusy
	}
	if effort != "" {
		return errors.New("ACP adapter does not support reasoning effort")
	}
	if model == "" {
		model = original
	}
	if current == model {
		return nil
	}
	if key == "" || model == "" {
		return errors.New("ACP agent does not expose a model selection")
	}
	return s.call(ctx, "session/set_config_option", object{"sessionId": s.id, "configId": key, "value": model}, func(raw json.RawMessage) error {
		var info sessionInfo
		if err := json.Unmarshal(raw, &info); err != nil {
			return err
		}
		s.settings(info.ConfigOptions)
		return nil
	})
}
func (s *session) settings(opts []configOption) {
	for _, opt := range opts {
		if opt.Category != "model" && opt.ID != "model" {
			continue
		}
		var value string
		if json.Unmarshal(opt.CurrentValue, &value) != nil {
			return
		}
		s.mu.Lock()
		if s.modelKey == "" {
			s.defaultModel = value
		}
		s.modelKey, s.currentModel = opt.ID, value
		s.mu.Unlock()
		s.emit(agent.SettingsReported{Model: value})
		return
	}
}
