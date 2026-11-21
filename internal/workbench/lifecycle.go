package workbench

import (
	"context"
	"errors"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
)

// Recovery is what the user chose to do with a native session that could
// not be resumed.
type Recovery int

const (
	// FreshWithReference starts a new native session, with a reference
	// of everything before it to the session itself in the composer.
	FreshWithReference Recovery = iota
	// Fresh starts a new native session without it.
	Fresh
	// Later leaves the session read-only for now.
	Later
)

// Recover does what the user chose for a session whose native session
// could not be resumed. A new native session is marked in the session
// (a Reset marker): the session goes on, its Agent's context empty.
func (w *Workbench) Recover(id string, r Recovery) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	if s.resumeFailed == "" {
		w.mu.Unlock()
		return nil
	}
	if r == Later {
		s.readOnly = true
		w.mu.Unlock()
		w.notify(Change{SessionID: id})
		return nil
	}
	if err := w.load(id, s); err != nil {
		w.mu.Unlock()
		return err
	}
	// An empty native ID: the next start begins a native session anew.
	if err := w.st.AddNativeSession(id, "", w.now()); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.NativeIDs = append(s.info.NativeIDs, "")
	w.addMarker(id, s, model.Marker{Kind: model.Reset, At: w.now()})
	s.resumeFailed, s.readOnly = "", false
	hasMessages := len(s.msgs) > 0
	w.mu.Unlock()
	if r == FreshWithReference && hasMessages {
		if _, err := w.ReferenceSession(id, id); err != nil && err != ErrNothingToRef {
			return err
		}
	}
	w.notify(Change{SessionID: id})
	return nil
}

// idleTimeout is how long a session's native session runs without a
// turn before it is stopped, unless Options.IdleTimeout says.
const idleTimeout = 30 * time.Minute

// reapIdle stops the native sessions idle for the timeout: no turn
// running, no approval waiting. They resume when a message comes.
func (w *Workbench) reapIdle() {
	now := w.now()
	var stop []agent.Session
	var ids []string
	w.mu.Lock()
	for id, s := range w.sessions {
		if s.native == nil || s.running || len(w.pending(s)) > 0 || now.Sub(s.lastActive) < w.idle {
			continue
		}
		stop, ids = append(stop, w.detach(id, s)), append(ids, id)
	}
	w.mu.Unlock()
	for _, n := range stop {
		n.Close()
	}
	for _, id := range ids {
		w.notify(Change{SessionID: id})
	}
}

// watchIdle reaps idle sessions every tick until the workbench closes.
func (w *Workbench) watchIdle(every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			w.reapIdle()
			w.checkWorkspaces()
		case <-w.done:
			return
		}
	}
}

// ErrNothingToRetry is what Retry returns when there is no message to
// send again.
var ErrNothingToRetry = errors.New("没有可以重试的消息")

// Retry sends the session's last user message again, with the references
// it delivered, as when the Agent was signed out: it is not recorded
// again.
func (w *Workbench) Retry(id string) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	switch {
	case !ok:
		w.mu.Unlock()
		return ErrNoSuchSession
	case s.running:
		w.mu.Unlock()
		return ErrTurnRunning
	case s.resumeFailed != "":
		w.mu.Unlock()
		return ErrNeedsRecovery
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
	var last *model.Message
	for i := len(s.msgs) - 1; i >= 0; i-- {
		if s.msgs[i].Kind == model.UserMessage {
			last = &s.msgs[i]
			break
		}
	}
	if last == nil {
		w.mu.Unlock()
		return ErrNothingToRetry
	}
	var briefs []string
	for _, rid := range last.Refs {
		if r, ok := w.refs[rid]; ok {
			briefs = append(briefs, r.Brief)
		}
	}
	text := refs.TurnText(briefs, last.Text)
	s.running, s.err, s.items, s.needsLogin = true, "", map[string]int{}, false
	s.since, s.retrying = w.now(), ""
	native, info := s.native, s.info
	ws, _ := w.workspace(info.WorkspaceID)
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
	if native == nil {
		var err error
		if native, err = w.connect(id, info, ws); err != nil {
			w.startFailed(id, err)
			return err
		}
	}
	if err := native.Send(context.Background(), agent.Turn{Text: text}); err != nil {
		w.fail(id, "发送失败："+err.Error())
		return err
	}
	return nil
}

// detach lets go of a session's native session, which the caller closes
// once w.mu is released: from then on the session has none, and its next
// message starts one, with a new token.
func (w *Workbench) detach(id string, s *session) agent.Session {
	n := s.native
	s.native = nil
	w.mcp.Revoke(id)
	return n
}
