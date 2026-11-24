package workbench

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
)

// A turn: the user's message sent, the native session started or resumed
// for it, its events pumped, and stopping it.

// Send sends the user's message to the session's Agent, starting or
// resuming its native session first if none is running.
//
// The session's draft references are delivered with the message: their
// blocks precede its text in what the Agent receives, and the message
// may then have no text of its own.
func (w *Workbench) Send(id, text string) error {
	return w.SendWithFiles(id, text, nil)
}

// SendWithFiles sends a message mentioning files (SendMessage).
func (w *Workbench) SendWithFiles(id, text string, mentions []model.Mention) error {
	return w.SendMessage(id, Outgoing{Text: text, Mentions: mentions})
}

// Outgoing is a message the user sends.
type Outgoing struct {
	Text string
	// Mentions are files whose paths only go to the Agent, which reads
	// them itself (ADR 0004). Each must be in the session's workspace or
	// a source workspace it may read (ErrNotReadable).
	Mentions []model.Mention
	// Attachments are images the Agent sees (ADR 0006), from
	// AttachImage for this session (ErrAttachmentGone).
	Attachments []model.Attachment
}

// SendMessage sends a message, with the references drafted for the
// session, and starts the Agent's turn.
func (w *Workbench) SendMessage(id string, o Outgoing) error {
	text, mentions := strings.TrimSpace(o.Text), o.Mentions
	images, err := w.turnImages(id, o.Attachments)
	if err != nil {
		return err
	}

	w.mu.Lock()
	s, ok := w.sessions[id]
	switch {
	case !ok:
		w.mu.Unlock()
		return ErrNoSuchSession
	case w.closing:
		w.mu.Unlock()
		return errWorkbenchClosing
	case s.resumeFailed != nil:
		w.mu.Unlock()
		return ErrNeedsRecovery
	}
	if slashCommand.MatchString(text) {
		// aibo's record would no longer match the Agent's state.
		w.mu.Unlock()
		return ErrSlashCommand
	}
	ws, _ := w.workspace(s.info.WorkspaceID)
	files, ok := turnFiles(mentions, ws.Path, s.info.ReadDirs)
	if !ok {
		w.mu.Unlock()
		return ErrNotReadable
	}
	if text == "" && len(w.drafts(id)) == 0 && len(mentions) == 0 && len(images) == 0 {
		w.mu.Unlock()
		return ErrEmptyMessage
	}
	if s.running {
		w.mu.Unlock()
		return ErrTurnRunning
	}
	if w.ready != nil {
		if err := w.ready(s.info.Agent); err != nil {
			w.mu.Unlock()
			return err
		}
	}
	if ws, _ := w.workspace(s.info.WorkspaceID); ws.Missing {
		w.mu.Unlock()
		return ErrWorkspaceMissing
	}
	if err := w.load(id, s); err != nil {
		w.mu.Unlock()
		return err
	}
	// Running from here, so that nothing else starts meanwhile.
	s.running, s.err, s.items, s.needsLogin = true, nil, map[string]int{}, false
	s.since, s.retrying = w.now(), nil
	var stop agent.Session
	if w.readDirs(id, s, ws) && s.native != nil && w.dirsAtStart(s.info.Agent) {
		// The Agent reads other workspaces only from its start.
		stop = w.detach(id, s)
	}
	native, info := s.native, s.info
	w.mu.Unlock()
	w.log.Info("turn started", "session", id, "agent", string(info.Agent), "references", len(w.Drafts(id)))
	if stop != nil {
		stop.Close()
	}

	// The native session first: if it cannot be resumed, nothing is
	// recorded, and the user's words stay in the composer.
	if native == nil {
		var err error
		if native, err = w.connect(id, info, ws); err != nil {
			w.startFailed(id, err)
			return err
		}
	}

	now := w.now()
	w.mu.Lock()
	drafts := w.drafts(id)
	m := model.Message{Kind: model.UserMessage, State: model.Done, Text: text, Mentions: mentions, Attachments: o.Attachments, CreatedAt: now, FinishedAt: now}
	seq, err := w.st.AppendMessage(id, m)
	if err != nil {
		s.running = false
		w.mu.Unlock()
		return err
	}
	m.Seq = seq
	var briefs []string
	for _, r := range drafts {
		m.Refs = append(m.Refs, r.ID)
		briefs = append(briefs, r.Brief)
	}
	if len(drafts) > 0 {
		if err := w.st.Deliver(m.Refs, seq); err != nil {
			s.running = false
			w.mu.Unlock()
			return err
		}
		for _, r := range drafts {
			r.State, r.MessageSeq = model.Delivered, seq
		}
	}
	s.msgs = append(s.msgs, m)
	if s.info.Title == "" && !s.info.TitleManual && text != "" {
		s.info.Title = defaultTitle(text)
		w.st.SetTitle(id, s.info.Title, false)
	}
	s.info.ActiveAt, s.lastActive = now, now
	w.st.Touch(id, now)
	w.mu.Unlock()
	w.notify(Change{SessionID: id, Message: &m})

	if err := native.Send(context.Background(), agent.Turn{Text: refs.TurnText(briefs, text), Files: files, Images: images}); err != nil {
		w.fail(id, StepSend, err)
		return err
	}
	return nil
}

// startFailed ends a turn whose native session did not start: a native
// session that cannot be resumed waits for the user to choose what to do
// (Recover).
func (w *Workbench) startFailed(id string, err error) {
	w.log.Warn("native session did not start", "session", id, "error", err.Error())
	if !errors.Is(err, agent.ErrResumeFailed) {
		w.fail(id, StepStart, err)
		return
	}
	w.mu.Lock()
	if s, ok := w.sessions[id]; ok {
		s.running, s.resumeFailed, s.readOnly = false, err, false
	}
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
}

// connect starts or resumes the session's native session and pumps its
// events.
func (w *Workbench) connect(id string, info model.Session, ws model.Workspace) (agent.Session, error) {
	a := w.agent(info.Agent)
	if a == nil {
		return nil, fmt.Errorf("%s：%w", info.Agent, ErrUnknownAgent)
	}
	w.log.Info("native session starting", "session", id, "resume", info.NativeID(), "model", info.Model, "effort", info.Effort, "mode", info.Mode)
	mcp := &agent.MCPServer{URL: w.mcp.URL(), Token: w.mcp.Issue(id)}
	native, err := a.Start(context.Background(), agent.StartOptions{Workspace: ws.Path, Model: info.Model, Effort: info.Effort, ResumeID: info.NativeID(), MCP: mcp,
		Mode: info.Mode, Rules: info.Rules, ReadDirs: info.ReadDirs})
	if err != nil {
		w.mcp.Revoke(id)
		return nil, err
	}
	w.mu.Lock()
	if w.closing {
		w.mu.Unlock()
		native.Close()
		return nil, errWorkbenchClosing
	}
	w.sessions[id].native = native
	w.sessions[id].lastActive = w.now()
	w.pumps.Add(1)
	w.mu.Unlock()
	w.log.Info("native session started", "session", id)
	go w.pump(id, native)
	return native, nil
}

// fail ends a turn that could not start.
func (w *Workbench) fail(id string, step Step, err error) {
	w.log.Warn("turn failed to start", "session", id, "step", string(step), "error", err.Error())
	w.mu.Lock()
	if s, ok := w.sessions[id]; ok {
		s.running, s.err = false, &Failure{step, err}
	}
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
}

// Stop interrupts the session's running turn.
func (w *Workbench) Stop(id string) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	native := s.native
	w.mu.Unlock()
	if native == nil {
		return nil
	}
	return native.Interrupt(context.Background())
}

// pump records a native session's events until it ends.
func (w *Workbench) pump(id string, native agent.Session) {
	defer w.pumps.Done()
	for ev := range native.Events() {
		w.handle(id, native, ev)
	}
	w.mu.Lock()
	s := w.sessions[id]
	if s == nil || s.native != native {
		// Deleted, or let go (detach): another native session may be
		// running a turn of its own now.
		w.mu.Unlock()
		return
	}
	s.native = nil
	w.mcp.Revoke(id)
	w.log.Warn("native session ended by itself", "session", id, "running", s.running)
	changed := w.endTurn(id, s, model.Interrupted)
	w.mu.Unlock()
	for _, m := range changed {
		w.notify(Change{SessionID: id, Message: &m})
	}
	w.notify(Change{SessionID: id})
}
