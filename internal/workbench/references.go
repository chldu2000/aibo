package workbench

import (
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/mcpserver"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
)

// ReferenceSession references the whole of the source session, as far as
// its messages have ended, in a draft for the target session's composer.
func (w *Workbench) ReferenceSession(sourceID, targetID string) (model.Reference, error) {
	return w.ReferenceRange(sourceID, 0, 0, targetID)
}

// ReferenceRange references the source session's messages from..to (0, 0
// for all those that have ended) in a draft for the target session's
// composer. The reference is a snapshot: what the source says or is
// called later does not change it.
func (w *Workbench) ReferenceRange(sourceID string, from, to int, targetID string) (model.Reference, error) {
	w.mu.Lock()
	src, ok := w.sessions[sourceID]
	tgt, ok2 := w.sessions[targetID]
	if !ok || !ok2 {
		w.mu.Unlock()
		return model.Reference{}, ErrNoSuchSession
	}
	ms, err := w.rangeOf(sourceID, src, from, to)
	if err != nil {
		w.mu.Unlock()
		return model.Reference{}, err
	}
	srcWS, _ := w.workspace(src.info.WorkspaceID)
	tgtWS, _ := w.workspace(tgt.info.WorkspaceID)
	r := w.newReference(newID("ref_"), src.info, srcWS, Target{SessionID: targetID, Agent: tgt.info.Agent, WorkspaceID: tgtWS.ID}, tgtWS, ms)
	r.TargetID = targetID
	if err := w.st.AddReference(r); err != nil {
		w.mu.Unlock()
		return model.Reference{}, err
	}
	w.refs[r.ID] = &r
	w.mu.Unlock()
	w.notify(Change{SessionID: targetID})
	return r, nil
}

// Target is where a reference goes: an existing session (SessionID), or
// a new session of an Agent in a workspace.
type Target struct {
	SessionID   string
	Agent       agent.Kind
	WorkspaceID string
}

// PreviewBrief returns the brief a reference of the source's messages
// from..to (0, 0 for all) would have for the target, but for its ID,
// given when the reference is made.
func (w *Workbench) PreviewBrief(sourceID string, from, to int, t Target) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	src, ok := w.sessions[sourceID]
	if !ok {
		return "", ErrNoSuchSession
	}
	ms, err := w.rangeOf(sourceID, src, from, to)
	if err != nil {
		return "", err
	}
	srcWS, _ := w.workspace(src.info.WorkspaceID)
	tgtWS, ok := w.workspace(t.WorkspaceID)
	if !ok {
		return "", ErrNoSuchWorkspace
	}
	return w.newReference("ref_（发出时生成）", src.info, srcWS, t, tgtWS, ms).Brief, nil
}

// rangeOf returns a session's messages from..to, all of which must have
// ended; 0, 0 is every message that has ended. w.mu is held.
func (w *Workbench) rangeOf(id string, s *session, from, to int) ([]model.Message, error) {
	if err := w.load(id, s); err != nil {
		return nil, err
	}
	// Only ended messages can be referenced; those still streaming are
	// at the end.
	var ended []model.Message
	for _, m := range s.msgs {
		if !m.State.Ended() {
			break
		}
		ended = append(ended, m)
	}
	if len(ended) == 0 {
		return nil, ErrNothingToRef
	}
	if from == 0 && to == 0 {
		return ended, nil
	}
	first, last := ended[0].Seq, ended[len(ended)-1].Seq
	if from > to || from < first || to > last {
		return nil, fmt.Errorf("%w: %s, of %s", ErrBadRange, refs.Range(from, to), refs.Range(first, last))
	}
	var out []model.Message
	for _, m := range ended {
		if m.Seq >= from && m.Seq <= to {
			out = append(out, m)
		}
	}
	return out, nil
}

// newReference makes a draft reference of messages ms of src, with its
// brief for a session of the Agent kind in workspace tgtWS. w.mu is held.
func (w *Workbench) newReference(id string, src model.Session, srcWS model.Workspace, t Target, tgtWS model.Workspace, ms []model.Message) model.Reference {
	r := model.Reference{
		ID:              id,
		SourceID:        src.ID,
		SourceTitle:     titleOf(src),
		SourceAgent:     src.Agent,
		SourceWorkspace: srcWS.Path,
		From:            ms[0].Seq,
		To:              ms[len(ms)-1].Seq,
		Count:           len(ms),
		State:           model.Draft,
		CreatedAt:       w.now(),
	}
	in := refs.BriefInput{
		ID:          r.ID,
		SourceTitle: r.SourceTitle,
		SourceAgent: w.agentDisplayName(src.Agent),
		Messages:    ms,
		ToolName:    w.toolNamer(t.Agent),
		Self:        t.SessionID == src.ID,
	}
	if srcWS.Path != tgtWS.Path {
		in.SourceWorkspace = srcWS.Path
	}
	r.Brief = refs.Brief(in)
	return r
}

// toolNamer names tools as an Agent of kind sees them.
func (w *Workbench) toolNamer(kind agent.Kind) func(string) string {
	if a := w.agent(kind); a != nil {
		return a.ToolName
	}
	return func(t string) string { return t }
}

func titleOf(x model.Session) string {
	if x.Title == "" {
		return "未命名会话"
	}
	return x.Title
}

// agentDisplayName is an Agent's name for the user, or its kind when it
// is not available.
func (w *Workbench) agentDisplayName(kind agent.Kind) string {
	if a := w.agent(kind); a != nil {
		return a.Name()
	}
	return string(kind)
}

// Drafts returns the session's draft references, oldest first.
func (w *Workbench) Drafts(sessionID string) []model.Reference {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []model.Reference
	for _, r := range w.drafts(sessionID) {
		out = append(out, *r)
	}
	return out
}

// drafts returns the session's draft references, oldest first. w.mu is
// held.
func (w *Workbench) drafts(sessionID string) []*model.Reference {
	var out []*model.Reference
	for _, r := range w.refs {
		if r.TargetID == sessionID && r.State == model.Draft {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.Before(out[j].CreatedAt) || out[i].CreatedAt.Equal(out[j].CreatedAt) && out[i].ID < out[j].ID
	})
	return out
}

// RemoveDraft removes a reference not yet sent from its composer.
func (w *Workbench) RemoveDraft(refID string) error {
	w.mu.Lock()
	r, ok := w.refs[refID]
	if !ok || r.State != model.Draft {
		w.mu.Unlock()
		return ErrNoSuchReference
	}
	if err := w.st.DeleteDraft(refID); err != nil {
		w.mu.Unlock()
		return err
	}
	delete(w.refs, refID)
	target := r.TargetID
	w.mu.Unlock()
	w.notify(Change{SessionID: target})
	return nil
}

// Reference returns one reference, with its reads.
func (w *Workbench) Reference(id string) (model.Reference, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	r, ok := w.refs[id]
	if !ok {
		return model.Reference{}, false
	}
	c := *r
	c.Reads = append([]model.ReferenceRead(nil), r.Reads...)
	return c, true
}

// DeleteSession deletes a session for good: its messages, and the
// references it received. References to it stay, but reading them says
// the source was deleted.
func (w *Workbench) DeleteSession(id string) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	native := s.native
	w.mu.Unlock()
	if native != nil {
		native.Close()
	}
	w.mu.Lock()
	if err := w.st.DeleteSession(id); err != nil {
		w.mu.Unlock()
		return err
	}
	delete(w.sessions, id)
	for rid, r := range w.refs {
		if r.TargetID == id {
			delete(w.refs, rid)
		}
	}
	w.mcp.Revoke(id)
	w.mu.Unlock()
	w.notify(Change{})
	return nil
}

// reader serves the workbench MCP server's tools.
type reader struct{ w *Workbench }

// delivered returns the references given to a session, oldest first.
// w.mu is held.
func (w *Workbench) delivered(sessionID string) []*model.Reference {
	var out []*model.Reference
	for _, r := range w.refs {
		if r.TargetID == sessionID && r.State == model.Delivered {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].MessageSeq != out[j].MessageSeq {
			return out[i].MessageSeq < out[j].MessageSeq
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}

func (rd reader) ListReferences(sessionID string) (string, error) {
	w := rd.w
	w.mu.Lock()
	defer w.mu.Unlock()
	given := w.delivered(sessionID)
	if len(given) == 0 {
		return "本会话还没有收到会话引用。", nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "交给本会话的会话引用共 %d 个：\n", len(given))
	for _, r := range given {
		b.WriteString("\n" + r.Brief + "\n")
	}
	return b.String(), nil
}

// given returns a delivered reference of the session, the range's
// messages, and the header of what reads return. w.mu is held.
func (w *Workbench) given(sessionID, refID string) (*model.Reference, []model.Message, string, error) {
	r, ok := w.refs[refID]
	if !ok || r.TargetID != sessionID || r.State != model.Delivered {
		return nil, nil, "", fmt.Errorf("本会话没有 ID 为 %q 的引用。可以用 %s 查看交给本会话的引用。", refID, w.receiverTools(sessionID)(refs.ToolListReferences))
	}
	ms, exists, err := w.st.MessageRange(r.SourceID, r.From, r.To)
	if err != nil {
		return nil, nil, "", err
	}
	if !exists {
		return nil, nil, "", fmt.Errorf("引用的源会话已被删除，引用 %s 已失效。", refID)
	}
	if len(ms) == 0 {
		return nil, nil, "", fmt.Errorf("引用 %s 的范围里没有消息。", refID)
	}
	cross := false
	if tgt, ok := w.sessions[sessionID]; ok {
		ws, _ := w.workspace(tgt.info.WorkspaceID)
		cross = ws.Path != r.SourceWorkspace
	}
	return r, ms, refs.ReadHeader(*r, cross), nil
}

// receiverTools names tools as the session's Agent sees them. w.mu is
// held.
func (w *Workbench) receiverTools(sessionID string) func(string) string {
	if s, ok := w.sessions[sessionID]; ok {
		return w.toolNamer(s.info.Agent)
	}
	return func(t string) string { return t }
}

func (rd reader) ReadReference(sessionID string, q mcpserver.ReadReference) (string, error) {
	w := rd.w
	w.mu.Lock()
	r, ms, header, err := w.given(sessionID, q.RefID)
	if err != nil {
		w.mu.Unlock()
		return "", err
	}
	read, err := refs.ReadPage(refs.ReadRequest{
		Ref: *r, Messages: ms, FromSeq: q.FromSeq, Cursor: q.Cursor, Thinking: q.IncludeThinking,
		AgentName: w.agentDisplayName(r.SourceAgent), ToolName: w.receiverTools(sessionID), Header: header, Budgets: w.budgets,
	})
	w.mu.Unlock()
	if err != nil {
		return "", err
	}
	w.recordRead(sessionID, q.RefID, read)
	return read.Text, nil
}

func (rd reader) ReadMessage(sessionID string, q mcpserver.ReadMessage) (string, error) {
	w := rd.w
	w.mu.Lock()
	r, ms, header, err := w.given(sessionID, q.RefID)
	if err != nil {
		w.mu.Unlock()
		return "", err
	}
	var m *model.Message
	for i := range ms {
		if ms[i].Seq == q.Seq {
			m = &ms[i]
		}
	}
	read, err := refs.ReadMessage(refs.MessageRequest{
		Ref: *r, Message: m, Seq: q.Seq, Cursor: q.Cursor, Thinking: q.IncludeThinking,
		AgentName: w.agentDisplayName(r.SourceAgent), ToolName: w.receiverTools(sessionID), Header: header, Budgets: w.budgets,
	})
	w.mu.Unlock()
	if err != nil {
		return "", err
	}
	w.recordRead(sessionID, q.RefID, read)
	return read.Text, nil
}

// recordRead records that the session's Agent read part of a reference.
func (w *Workbench) recordRead(sessionID, refID string, read refs.Read) {
	w.mu.Lock()
	if r, ok := w.refs[refID]; ok {
		rd := model.ReferenceRead{From: read.From, To: read.To, At: w.now()}
		if err := w.st.AddRead(refID, rd); err == nil {
			r.Reads = append(r.Reads, rd)
		}
	}
	w.mu.Unlock()
	w.notify(Change{SessionID: sessionID})
}

func (rd reader) SearchReference(sessionID string, q mcpserver.SearchReference) (string, error) {
	w := rd.w
	w.mu.Lock()
	defer w.mu.Unlock()
	var targets []*model.Reference
	if q.RefID != "" {
		r, ok := w.refs[q.RefID]
		if !ok || r.TargetID != sessionID || r.State != model.Delivered {
			return "", fmt.Errorf("本会话没有 ID 为 %q 的引用。可以用 %s 查看交给本会话的引用。", q.RefID, w.receiverTools(sessionID)(refs.ToolListReferences))
		}
		targets = []*model.Reference{r}
	} else {
		targets = w.delivered(sessionID)
	}
	if len(targets) == 0 {
		return "本会话还没有收到会话引用，没有可搜索的内容。", nil
	}
	var searched []refs.Searched
	for _, r := range targets {
		ms, exists, err := w.st.MessageRange(r.SourceID, r.From, r.To)
		if err != nil {
			return "", err
		}
		if !exists {
			if q.RefID != "" {
				return "", fmt.Errorf("引用的源会话已被删除，引用 %s 已失效。", r.ID)
			}
			continue // the others are still searched
		}
		searched = append(searched, refs.Searched{Ref: *r, Messages: ms, AgentName: w.agentDisplayName(r.SourceAgent)})
	}
	return refs.Search(refs.SearchRequest{
		Refs: searched, Query: q.Query, Regex: q.Regex, Thinking: q.IncludeThinking, Cursor: q.Cursor,
		ToolName: w.receiverTools(sessionID),
	})
}

// readDirs adds to the session's readable workspaces those of the
// references about to be delivered from other workspaces, reporting
// whether there were new ones. w.mu is held.
func (w *Workbench) readDirs(id string, s *session, ws model.Workspace) bool {
	added := false
	for _, r := range w.drafts(id) {
		d := r.SourceWorkspace
		if d == "" || d == ws.Path || slices.Contains(s.info.ReadDirs, d) {
			continue
		}
		s.info.ReadDirs, added = append(s.info.ReadDirs, d), true
	}
	if added {
		w.st.SetReadDirs(id, s.info.ReadDirs)
	}
	return added
}

// dirsAtStart reports whether the Agent takes readable workspaces only
// when a session starts.
func (w *Workbench) dirsAtStart(kind agent.Kind) bool {
	d, ok := w.agent(kind).(agent.DirsAtStart)
	return ok && d.DirsAtStart()
}
