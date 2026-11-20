package workbench

import (
	"context"
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
	return err == nil && rel != ".." && !strings.HasPrefix(rel, "../")
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
