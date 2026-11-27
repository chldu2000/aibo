package codex

import (
	"context"
	"encoding/json"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// Codex's Agent commands. Its app-server knows none of the TUI's own
// commands: the adapter offers those it carries out with the app-server's
// methods, or that the workbench's controls do (ADR 0007; ruled on in
// .scratch/agent-commands/issues/03), then the skills skills/list tells,
// which take "$name" and a skill input item
// (.scratch/agent-commands/research/01).

// builtins are the TUI's commands offered, in its own words.
var builtins = []agent.Command{
	{Name: "model", Description: "choose what model and reasoning effort to use", ArgumentHint: "<model>", Builtin: true, Handling: agent.ByModel},
	{Name: "permissions", Description: "choose what Codex is allowed to do", ArgumentHint: "<mode>", Builtin: true, Handling: agent.ByMode},
	{Name: "compact", Description: "summarize conversation to prevent hitting the context limit", Builtin: true, Handling: agent.ByCompact},
	// review/start: the uncommitted changes, or what the words after it ask
	// for (its "custom" target).
	{Name: "review", Description: "review my current changes and find issues", ArgumentHint: "[instructions]", Builtin: true},
	{Name: "rename", Description: "rename the current thread", ArgumentHint: "<name>", Builtin: true, Handling: agent.ByRename},
	{Name: "new", Description: "start a new chat during a conversation", Builtin: true, Handling: agent.ByReset},
	{Name: "clear", Description: "clear the terminal and start a new chat", Builtin: true, Handling: agent.ByReset},
}

// skillData is what a skill's command keeps for the adapter.
type skillData struct {
	Path string `json:"path"`
}

// commands are the built-ins, then the skills enabled for the workspace
// of skills/list's result, as Codex orders them; a skill named as a
// built-in is left out.
func commands(result json.RawMessage) []agent.Command {
	out := append([]agent.Command(nil), builtins...)
	taken := map[string]bool{}
	for _, b := range builtins {
		taken[b.Name] = true
	}
	var res struct {
		Data []struct {
			Skills []struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Path        string `json:"path"`
				Scope       string `json:"scope"`
				Enabled     bool   `json:"enabled"`
				Interface   *struct {
					ShortDescription string `json:"shortDescription"`
				} `json:"interface"`
			} `json:"skills"`
		} `json:"data"`
	}
	json.Unmarshal(result, &res)
	for _, d := range res.Data {
		for _, sk := range d.Skills {
			if !sk.Enabled || taken[sk.Name] {
				continue
			}
			taken[sk.Name] = true
			desc := sk.Description
			if desc == "" && sk.Interface != nil {
				desc = sk.Interface.ShortDescription
			}
			data, _ := json.Marshal(skillData{Path: sk.Path})
			out = append(out, agent.Command{Name: sk.Name, Description: desc, Source: sk.Scope, Data: data})
		}
	}
	return out
}

// listSkills asks the app-server for the skills of workspace.
func (s *server) listSkills(ctx context.Context, workspace string) ([]agent.Command, error) {
	var raw json.RawMessage
	if err := s.call(ctx, "skills/list", map[string]any{"cwds": []string{workspace}}, &raw); err != nil {
		return nil, err
	}
	return commands(raw), nil
}

// idleFor is how long an app-server started only to list skills runs on
// with no thread, for a message that may follow.
const idleFor = time.Minute

// Commands lists the commands for workspace without a thread.
func (a *Agent) Commands(ctx context.Context, workspace string) ([]agent.Command, error) {
	srv, err := a.server(ctx)
	if err != nil {
		return nil, err
	}
	defer time.AfterFunc(idleFor, srv.stopIfIdle)
	return srv.listSkills(ctx, workspace)
}

// stopIfIdle stops the server if no thread uses it, nor any call waits.
func (s *server) stopIfIdle() {
	s.mu.Lock()
	idle := len(s.sessions) == 0 && len(s.pending) == 0 && !s.dead
	s.mu.Unlock()
	if idle {
		s.onIdle(s)
		s.stop()
	}
}

// skillsChanged has every thread tell its commands again, listed anew:
// skills/changed says only that they may have.
func (s *server) skillsChanged() {
	s.mu.Lock()
	sessions := make([]*session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		sessions = append(sessions, sess)
	}
	s.mu.Unlock()
	for _, sess := range sessions {
		go sess.relist()
	}
}

func (s *session) relist() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmds, err := s.srv.listSkills(ctx, s.cwd)
	if err != nil {
		s.srv.log.Warn("skills/list failed", "error", err.Error())
		return
	}
	s.emit(agent.CommandsChanged{Commands: cmds})
}

// emit delivers events unless the session was let go.
func (s *session) emit(evs ...agent.Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	for _, e := range evs {
		s.events <- e
	}
}

// commandText is how Codex takes a turn invoking a skill: "$name", then
// what follows; skillInput is the item that names the skill's file.
func commandText(turn agent.Turn) string {
	if turn.Command == nil {
		return turn.Text
	}
	if turn.Text == "" {
		return "$" + turn.Command.Name
	}
	return "$" + turn.Command.Name + " " + turn.Text
}

func skillInput(c *agent.Command) (map[string]any, bool) {
	if c == nil {
		return nil, false
	}
	var d skillData
	if json.Unmarshal(c.Data, &d) != nil || d.Path == "" {
		return nil, false
	}
	return map[string]any{"type": "skill", "name": c.Name, "path": d.Path}, true
}

// reset carries out "/clear" and "/new" as the TUI does: a new thread, in
// the same settings, which the session goes on in. It is a turn of its
// own, which reports ContextReset and the new native session.
func (s *session) reset() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	s.mu.Lock()
	params := s.threadParams()
	s.mu.Unlock()
	var raw json.RawMessage
	if err := s.srv.call(ctx, "thread/start", params, &raw); err != nil {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
		s.emit(agent.Failed{Message: "thread/start: " + err.Error()}, agent.TurnEnded{})
		return
	}
	var res struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	json.Unmarshal(raw, &res)
	s.mu.Lock()
	old := s.id
	s.id = res.Thread.ID
	// The effort goes with the first turn, as on Start.
	s.effort = s.current.effort
	s.mu.Unlock()
	s.srv.rekey(s, old, res.Thread.ID)
	go s.srv.call(context.Background(), "thread/unsubscribe", map[string]any{"threadId": old}, nil)
	evs := []agent.Event{agent.ContextReset{}, agent.NativeSessionStarted{ID: res.Thread.ID}, threadSettings(raw)}
	if m := threadMode(raw); m != "" {
		evs = append(evs, agent.ModeReported{ID: m})
	}
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
	s.emit(append(evs, agent.TurnEnded{})...)
}

// rekey files a session under its new thread, letting the old go.
func (s *server) rekey(sess *session, old, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, old)
	s.sessions[id] = sess
}

// isReview reports whether a turn invokes "/review", which the adapter
// carries out with review/start, not a skill of that name.
func isReview(c *agent.Command) bool { return c != nil && c.Builtin && c.Name == "review" }

// reviewParams are review/start's: the uncommitted changes, as the TUI's
// first choice, or what instructions ask for. The review runs inline, in
// the thread, as a turn.
func reviewParams(thread, instructions string) map[string]any {
	target := map[string]any{"type": "uncommittedChanges"}
	if instructions != "" {
		target = map[string]any{"type": "custom", "instructions": instructions}
	}
	return map[string]any{"threadId": thread, "target": target}
}
