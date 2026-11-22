package workbench

import (
	"context"

	"github.com/chldu2000/aibo/internal/agent"
)

// SetModel changes a session's model and reasoning effort, empty for the
// Agent's own, from its next turn on: only while no turn runs, which
// ErrTurnRunning says. A running native session changes at once, and then
// reports what it uses (Status.Model, Status.Effort); else the session
// starts on them.
func (w *Workbench) SetModel(sessionID, model, effort string) error {
	w.mu.Lock()
	s, ok := w.sessions[sessionID]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	if s.running {
		w.mu.Unlock()
		return ErrTurnRunning
	}
	if err := w.st.SetModel(sessionID, model, effort); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.Model, s.info.Effort = model, effort
	native := s.native
	if native == nil {
		// What it last said no longer holds; it says again as it starts.
		s.reported = agent.SettingsReported{}
	}
	w.mu.Unlock()
	if native != nil {
		if err := native.SetModel(context.Background(), model, effort); err != nil {
			return err
		}
	}
	w.notify(Change{SessionID: sessionID})
	return nil
}
