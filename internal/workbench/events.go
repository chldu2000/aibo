package workbench

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
)

// itemKey keys a turn's item: a reply ("r"), tool call ("t") or plan ("p")
// by its Agent ID.
func itemKey(kind, id string) string { return kind + ":" + id }

// handle records one event of a session's native session from.
func (w *Workbench) handle(id string, from agent.Session, ev agent.Event) {
	now := w.now()
	w.mu.Lock()
	s := w.sessions[id]
	if s == nil || s.native != from {
		// Deleted, or a native session let go (detach) still talking.
		w.mu.Unlock()
		return
	}
	if s.items == nil {
		s.items = map[string]int{}
	}
	var changed []model.Message
	// touched marks message i as changed; flush writes it now rather than
	// at the next flush.
	touched := map[int]bool{}
	touch := func(i int, flush bool) {
		touched[i] = touched[i] || flush
	}
	// Anything but another retry, or what it uses: the Agent got on.
	switch ev.(type) {
	case agent.Retrying, agent.SettingsReported, agent.ModeReported:
	default:
		s.retrying = nil
	}
	switch e := ev.(type) {
	case agent.Retrying:
		w.log.Warn("agent retrying", "session", id, "message", e.Message)
		if s.running {
			s.retrying = &e
		}
	case agent.SettingsReported:
		s.reported = e
	case agent.ModeReported:
		s.reportedMode = e.ID
		// The Agent changed its mode itself, as Claude Code leaving plan
		// mode: the session follows, and starts again in it.
		if e.ID != "" && s.info.Mode != "" && e.ID != s.info.Mode {
			w.log.Info("agent changed its mode", "session", id, "from", s.info.Mode, "to", e.ID)
			if err := w.st.SetApproval(id, e.ID, s.info.Rules); err == nil {
				s.info.Mode = e.ID
			}
		}
	case agent.NativeSessionStarted:
		if e.ID != "" && e.ID != s.info.NativeID() {
			if err := w.st.AddNativeSession(id, e.ID, now); err == nil {
				s.info.NativeIDs = append(s.info.NativeIDs, e.ID)
			}
		}
	case agent.ReplyDelta:
		if e.Parent != "" {
			w.child(s, e.Parent, now, touch, func(p *model.Message) {
				c := childItem(p, "r:"+e.ReplyID, model.AgentReply, now)
				c.Text += e.Text
			})
			break
		}
		if i, created, ok := w.item(id, s, itemKey("r", e.ReplyID), model.Message{Kind: model.AgentReply, Text: e.Text, Raw: e.Raw, CreatedAt: now}); ok {
			if !created {
				s.msgs[i].Text += e.Text
				if len(e.Raw) > 0 {
					s.msgs[i].Raw = e.Raw
				}
			}
			touch(i, false)
		}
	case agent.ThinkingDelta:
		if e.Parent != "" {
			w.child(s, e.Parent, now, touch, func(p *model.Message) {
				c := childItem(p, "r:"+e.ReplyID, model.AgentReply, now)
				c.Thinking += e.Text
			})
			break
		}
		if i, _, ok := w.item(id, s, itemKey("r", e.ReplyID), model.Message{Kind: model.AgentReply, CreatedAt: now}); ok {
			s.msgs[i].Thinking += e.Text
			touch(i, false)
		}
	case agent.ReplyDone:
		if e.Parent != "" {
			w.child(s, e.Parent, now, touch, func(p *model.Message) {
				c := childItem(p, "r:"+e.ReplyID, model.AgentReply, now)
				if e.Text != "" {
					c.Text = e.Text
				}
				c.State, c.FinishedAt = model.Done, now
			})
			break
		}
		i, ok := s.items[itemKey("r", e.ReplyID)]
		if !ok && e.Text != "" {
			// A reply that came whole, without deltas.
			i, _, ok = w.item(id, s, itemKey("r", e.ReplyID), model.Message{Kind: model.AgentReply, CreatedAt: now})
		}
		if !ok || s.msgs[i].State.Ended() {
			break
		}
		m := &s.msgs[i]
		if e.Text != "" {
			m.Text = e.Text
		}
		if len(e.Raw) > 0 {
			m.Raw = e.Raw
		}
		m.State, m.FinishedAt = model.Done, now
		touch(i, true)
	case agent.ToolStarted:
		tool := &model.Tool{Name: e.Name, Input: e.Input}
		if e.Parent != "" {
			w.child(s, e.Parent, now, touch, func(p *model.Message) {
				c := childItem(p, "t:"+e.ToolID, model.ToolCall, now)
				c.Tool = tool
			})
			break
		}
		if i, _, ok := w.item(id, s, itemKey("t", e.ToolID), model.Message{Kind: model.ToolCall, Tool: tool, Raw: e.Raw, CreatedAt: now}); ok {
			// An approval request that came first goes on its call.
			for k, l := range s.loose {
				if l.toolID == e.ToolID {
					s.msgs[i].Tool.Approval = l.a
					s.loose = append(s.loose[:k:k], s.loose[k+1:]...)
					break
				}
			}
			touch(i, true)
		}
	case agent.ToolOutputDelta:
		i, ok := s.items[itemKey("t", e.ToolID)]
		if !ok || s.msgs[i].State.Ended() {
			break
		}
		t := s.msgs[i].Tool
		if t == nil || t.Truncated || e.Text == "" {
			break
		}
		room := model.MaxToolOutput - len(t.Output)
		chunk := e.Text
		if len(chunk) > room {
			chunk = strings.ToValidUTF8(chunk[:room], "")
			t.Truncated = true
		}
		t.Output += chunk
		touch(i, false)
	case agent.ToolFinished:
		finish := func(m *model.Message) {
			if m.Tool == nil {
				m.Tool = &model.Tool{}
			}
			out := e.Output
			if e.KeepStreamedOutput {
				out = m.Tool.Output
			} else {
				m.Tool.Truncated = false
			}
			if len(out) > model.MaxToolOutput {
				out = strings.ToValidUTF8(out[:model.MaxToolOutput], "")
				m.Tool.Truncated = true
			}
			m.Tool.Output, m.Tool.IsError, m.Tool.Done = out, e.IsError, true
			m.Tool.Declined, m.Tool.ExitCode = e.Declined, e.ExitCode
			m.State, m.FinishedAt = model.Done, now
		}
		if e.Parent != "" {
			w.child(s, e.Parent, now, touch, func(p *model.Message) {
				finish(childItem(p, "t:"+e.ToolID, model.ToolCall, now))
			})
			break
		}
		i, ok := s.items[itemKey("t", e.ToolID)]
		if !ok || s.msgs[i].State.Ended() {
			break
		}
		finish(&s.msgs[i])
		if len(e.Raw) > 0 {
			s.msgs[i].Raw = e.Raw
		}
		// The subagent's messages ended with it.
		for c := range s.msgs[i].Children {
			if ch := &s.msgs[i].Children[c]; !ch.State.Ended() {
				ch.State, ch.FinishedAt = model.Done, now
			}
		}
		touch(i, true)
	case agent.PlanUpdated:
		key := itemKey("p", e.PlanID)
		if i, ok := s.items[key]; ok && !s.msgs[i].State.Ended() {
			s.msgs[i].Plan, s.msgs[i].Text = e.Items, planText(e.Items)
			touch(i, true)
			break
		}
		if i, _, ok := w.item(id, s, key, model.Message{Kind: model.Plan, Plan: e.Items, Text: planText(e.Items), Raw: e.Raw, CreatedAt: now}); ok {
			touch(i, true)
		}
	case agent.ApprovalRequested:
		a := &model.Approval{ID: e.ID, Action: e.Action, Tool: e.Tool, WriteRoot: e.WriteRoot, Command: e.Command, Cwd: e.Cwd, Reason: e.Reason, Diff: e.Diff, Plan: e.Plan,
			Paths: e.Paths, Input: e.Input, Options: e.Options, Outside: w.outside(s, e.Paths)}
		if i, ok := s.items[itemKey("t", e.ToolID)]; ok && !s.msgs[i].State.Ended() && s.msgs[i].Tool != nil {
			s.msgs[i].Tool.Approval = a
			touch(i, true)
			break
		}
		s.loose = append(s.loose, looseApproval{toolID: e.ToolID, a: a})
	case agent.TurnEnded:
		if s.restart && s.native != nil {
			// A rule was revoked during the turn: start again without it.
			s.restart = false
			go w.detach(id, s).Close()
		}
		end := model.Done
		if e.Interrupted {
			end = model.Interrupted
		}
		w.log.Info("turn ended", "session", id, "interrupted", e.Interrupted, "took", now.Sub(s.since).Round(time.Millisecond))
		changed = w.endTurn(id, s, end)
		s.info.ActiveAt, s.lastActive = now, now
		w.st.Touch(id, now)
	case agent.Compacted:
		w.log.Info("context compacted", "session", id, "trigger", e.Trigger, "before", e.PreTokens, "after", e.PostTokens)
		w.addMarker(id, s, model.Marker{Kind: model.Compaction, Trigger: e.Trigger, PreTokens: e.PreTokens, PostTokens: e.PostTokens, At: now})
	case agent.NotLoggedIn:
		w.log.Warn("agent signed out", "session", id)
		s.needsLogin = true
		if w.loggedOut != nil {
			kind := s.info.Agent
			defer func() { go w.loggedOut(kind) }()
		}
	case agent.Failed:
		w.log.Warn("agent failed", "session", id, "message", e.Message)
		s.err = &Failure{StepAgent, e}
	}
	idx := make([]int, 0, len(touched))
	for i := range touched {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	for _, i := range idx {
		m := s.msgs[i]
		if touched[i] || m.State.Ended() || now.Sub(s.lastFlush) >= flushEvery {
			w.st.UpdateMessage(id, m)
			if !m.State.Ended() {
				s.lastFlush = now
			}
		}
		changed = append(changed, m.Clone())
	}
	w.mu.Unlock()
	for _, m := range changed {
		w.notify(Change{SessionID: id, Message: &m})
	}
	if len(changed) == 0 {
		w.notify(Change{SessionID: id})
	}
}

// item returns the index of the turn's item key, appending m (streaming)
// as a new message, created, when the turn has none. ok is false when it
// could not be stored, or the item has ended. w.mu is held.
func (w *Workbench) item(id string, s *session, key string, m model.Message) (i int, created, ok bool) {
	if i, ok := s.items[key]; ok {
		return i, false, !s.msgs[i].State.Ended()
	}
	m.State = model.Streaming
	seq, err := w.st.AppendMessage(id, m)
	if err != nil {
		s.err = &Failure{StepSave, err}
		return 0, false, false
	}
	m.Seq = seq
	s.msgs = append(s.msgs, m)
	s.items[key] = len(s.msgs) - 1
	s.lastFlush = w.now()
	return len(s.msgs) - 1, true, true
}

// child runs fn on the tool call parent, running a subagent, to change
// the subagent's messages. w.mu is held.
func (w *Workbench) child(s *session, parent string, now time.Time, touch func(int, bool), fn func(p *model.Message)) {
	i, ok := s.items[itemKey("t", parent)]
	if !ok || s.msgs[i].State.Ended() {
		return
	}
	fn(&s.msgs[i])
	touch(i, false)
}

// childItem returns the subagent's message key in p, adding it.
func childItem(p *model.Message, key string, kind model.MessageKind, now time.Time) *model.Message {
	for i := range p.Children {
		if p.Children[i].AgentID == key {
			return &p.Children[i]
		}
	}
	p.Children = append(p.Children, model.Message{Kind: kind, State: model.Streaming, AgentID: key, CreatedAt: now})
	return &p.Children[len(p.Children)-1]
}

// endTurn ends the running turn, ending its messages still streaming as
// state. w.mu is held. It returns the messages it changed.
func (w *Workbench) endTurn(id string, s *session, state model.MessageState) []model.Message {
	var changed []model.Message
	now := w.now()
	for _, i := range s.items {
		m := &s.msgs[i]
		if m.State.Ended() {
			continue
		}
		if m.Tool != nil && m.Tool.Approval.Pending() {
			m.Tool.Approval.Expired = true
		}
		m.State, m.FinishedAt = state, now
		if m.Kind == model.ToolCall && state == model.Done {
			// A tool call the turn ended without: it never finished.
			m.State = model.Interrupted
		}
		for c := range m.Children {
			if ch := &m.Children[c]; !ch.State.Ended() {
				ch.State, ch.FinishedAt = m.State, now
			}
		}
		w.st.UpdateMessage(id, *m)
		changed = append(changed, m.Clone())
	}
	sort.Slice(changed, func(i, j int) bool { return changed[i].Seq < changed[j].Seq })
	s.running, s.items, s.loose = false, nil, nil
	return changed
}

// planText is a plan as text, one step a line, for reading and search.
func planText(items []agent.PlanItem) string {
	var b strings.Builder
	for _, it := range items {
		mark := "[ ]"
		switch it.Status {
		case agent.PlanCompleted:
			mark = "[x]"
		case agent.PlanInProgress:
			mark = "[~]"
		}
		fmt.Fprintf(&b, "- %s %s\n", mark, it.Text)
	}
	return strings.TrimRight(b.String(), "\n")
}
