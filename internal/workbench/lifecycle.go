package workbench

import (
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
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
	w.mu.Lock()
	for _, s := range w.sessions {
		if s.native == nil || s.running || len(w.pending(s)) > 0 || now.Sub(s.lastActive) < w.idle {
			continue
		}
		stop = append(stop, s.native)
	}
	w.mu.Unlock()
	for _, n := range stop {
		n.Close()
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
		case <-w.done:
			return
		}
	}
}
