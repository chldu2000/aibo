package workbench

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
)

// looseApproval is an approval request whose tool call has not started.
type looseApproval struct {
	toolID string
	a      *model.Approval
}

// outside reports whether any of paths is outside the session's
// workspace. w.mu is held.
func (w *Workbench) outside(s *session, paths []string) bool {
	ws, _ := w.workspace(s.info.WorkspaceID)
	for _, p := range paths {
		// A Windows path starting with a separator is rooted on the workspace's drive.
		if len(p) > 0 && filepath.VolumeName(p) == "" && os.IsPathSeparator(p[0]) {
			p = filepath.VolumeName(ws.Path) + p
		}
		if !filepath.IsAbs(p) {
			continue // relative to the workspace
		}
		// /tmp and /private/tmp are one place on macOS: compare both ways.
		if !within(p, ws.Path) && !within(resolve(p), resolve(ws.Path)) {
			return true
		}
	}
	return false
}

func within(p, root string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && filepath.IsLocal(rel)
}

// resolve resolves the symbolic links of p's longest existing start.
func resolve(p string) string {
	p = filepath.Clean(p)
	for dir, rest := p, ""; ; {
		if r, err := filepath.EvalSymlinks(dir); err == nil {
			return filepath.Join(r, rest)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return p
		}
		rest = filepath.Join(filepath.Base(dir), rest)
		dir = parent
	}
}

// pending returns the session's approval requests waiting for an answer,
// in the order of their tool calls, then those whose calls have not
// started. w.mu is held.
func (w *Workbench) pending(s *session) []*model.Approval {
	var out []*model.Approval
	for i := len(s.msgs) - 1; i >= 0 && s.items != nil; i-- {
		if m := s.msgs[i]; m.Tool != nil && m.Tool.Approval.Pending() && !m.State.Ended() {
			out = append([]*model.Approval{m.Tool.Approval}, out...)
		}
	}
	for _, l := range s.loose {
		if l.a.Pending() {
			out = append(out, l.a)
		}
	}
	return out
}

// LooseApprovals returns the session's approval requests whose tool
// calls have not started, to show apart from the calls.
func (w *Workbench) LooseApprovals(sessionID string) []model.Approval {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[sessionID]
	if !ok {
		return nil
	}
	var out []model.Approval
	for _, l := range s.loose {
		m := model.Message{Tool: &model.Tool{Approval: l.a}}
		out = append(out, *m.Clone().Tool.Approval)
	}
	return out
}

// Approve answers an approval request with one of its options; note,
// for a denial, tells the Agent why.
func (w *Workbench) Approve(sessionID, approvalID, optionID, note string) error {
	w.mu.Lock()
	s, ok := w.sessions[sessionID]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	var a *model.Approval
	for _, p := range w.pending(s) {
		if p.ID == approvalID {
			a = p
		}
	}
	native := s.native
	w.mu.Unlock()
	if a == nil || native == nil {
		return ErrNoSuchApproval
	}
	idx := -1
	for i, o := range a.Options {
		if o.ID == optionID {
			idx = i
		}
	}
	if idx < 0 {
		return ErrNoSuchApproval
	}
	note = strings.TrimSpace(note)
	// The answer is recorded before the Agent has it: once it has, the
	// tool call can end at any moment, and an ended message never
	// changes again.
	record := func(answer *agent.ApprovalOption, note string) *model.Message {
		w.mu.Lock()
		defer w.mu.Unlock()
		a.Answer, a.Note = answer, note
		if answer != nil && answer.Kind == agent.AllowSession {
			w.remember(sessionID, s, answer.Rules)
		}
		for i := range s.msgs {
			if m := &s.msgs[i]; m.Tool != nil && m.Tool.Approval == a && !m.State.Ended() {
				w.st.UpdateMessage(sessionID, *m)
				c := m.Clone()
				return &c
			}
		}
		return nil
	}
	opt := a.Options[idx]
	changed := record(&opt, note)
	if err := native.RespondApproval(context.Background(), approvalID, optionID, note); err != nil {
		w.notify(Change{SessionID: sessionID, Message: record(nil, "")})
		return err
	}
	w.notify(Change{SessionID: sessionID, Message: changed})
	return nil
}

// remember adds rules the user allowed for the rest of the session.
// w.mu is held.
func (w *Workbench) remember(id string, s *session, rules []agent.Rule) {
	added := false
	for _, r := range rules {
		dup := false
		for _, have := range s.info.Rules {
			dup = dup || have.Label == r.Label && string(have.Data) == string(r.Data)
		}
		if !dup {
			s.info.Rules, added = append(s.info.Rules, r), true
		}
	}
	if added {
		w.st.SetApproval(id, s.info.Mode, s.info.Rules)
	}
}

// SetMode sets a session's permission mode, one of its Agent's own, from
// its next request on; empty is the one the Agent marks Default.
func (w *Workbench) SetMode(sessionID, mode string) error {
	w.mu.Lock()
	s, ok := w.sessions[sessionID]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	kind := s.info.Agent
	w.mu.Unlock()
	if mode != "" && !w.hasMode(kind, mode) {
		return ErrNoSuchMode
	}
	w.mu.Lock()
	if err := w.st.SetApproval(sessionID, mode, s.info.Rules); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.Mode = mode
	native := s.native
	w.log.Info("mode set", "session", sessionID, "mode", mode, "connected", native != nil)
	w.mu.Unlock()
	if native != nil && mode != "" {
		if err := native.SetMode(context.Background(), mode); err != nil {
			return err
		}
	}
	w.notify(Change{SessionID: sessionID})
	return nil
}

// PermissionModes returns an Agent's permission modes, if it tells.
func (w *Workbench) PermissionModes(ctx context.Context, kind agent.Kind) ([]agent.PermissionMode, error) {
	if l, ok := w.agent(kind).(agent.ModeLister); ok {
		return l.PermissionModes(ctx)
	}
	return nil, nil
}

// hasMode reports whether mode is one of an Agent's; any is, for an
// Agent that does not tell.
func (w *Workbench) hasMode(kind agent.Kind, mode string) bool {
	l, ok := w.agent(kind).(agent.ModeLister)
	if !ok {
		return true
	}
	modes, err := l.PermissionModes(context.Background())
	if err != nil {
		return true // the Agent will say
	}
	for _, m := range modes {
		if m.ID == mode {
			return true
		}
	}
	return false
}

// RevokeRule takes back a rule allowed for the rest of the session. The
// Agent cannot forget it while it runs: its native session starts again
// (resumed, without the rule) when idle.
func (w *Workbench) RevokeRule(sessionID string, i int) error {
	w.mu.Lock()
	s, ok := w.sessions[sessionID]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	if i < 0 || i >= len(s.info.Rules) {
		w.mu.Unlock()
		return ErrNoSuchRule
	}
	rules := append(append([]agent.Rule(nil), s.info.Rules[:i]...), s.info.Rules[i+1:]...)
	if err := w.st.SetApproval(sessionID, s.info.Mode, rules); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.Rules = rules
	var stop agent.Session
	if s.native != nil {
		if s.running {
			s.restart = true
		} else {
			stop = w.detach(sessionID, s)
		}
	}
	w.mu.Unlock()
	if stop != nil {
		stop.Close()
	}
	w.notify(Change{SessionID: sessionID})
	return nil
}
