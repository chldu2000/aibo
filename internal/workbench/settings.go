package workbench

import (
	"errors"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/refs"
)

// Settings are the user's settings that the workbench keeps with its
// data.
type Settings struct {
	// DefaultLevel is the approval level of new sessions.
	DefaultLevel agent.ApprovalLevel
	// Notify notifies of approval requests of sessions not on screen.
	Notify bool
	// Budgets are the read tools' page sizes.
	Budgets refs.Budgets
	// IdleTimeout is how long a native session runs without a turn
	// before it is stopped.
	IdleTimeout time.Duration
}

// DefaultSettings are the settings until the user changes them.
var DefaultSettings = Settings{DefaultLevel: agent.AskAlways, Notify: true, Budgets: refs.DefaultBudgets, IdleTimeout: idleTimeout}

// settingsKey is the settings' key in the store.
const settingsKey = "workbench"

// ErrBadSettings is what SetSettings returns for settings out of range.
var ErrBadSettings = errors.New("设置的值不在允许的范围内")

// Settings returns the settings.
func (w *Workbench) Settings() Settings {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.settings
}

// SetSettings changes the settings, which apply at once: to new
// sessions, the reads to come, and the idle sessions.
func (w *Workbench) SetSettings(s Settings) error {
	switch s.DefaultLevel {
	case agent.AskAlways, agent.AcceptEdits, agent.FullAuto:
	default:
		return ErrBadSettings
	}
	b := s.Budgets
	if b.Page < 1000 || b.Page > 200000 || b.ToolOutput < 200 || b.ToolOutput > b.Page || b.MessagePage < 1000 || b.MessagePage > 500000 ||
		s.IdleTimeout < time.Minute || s.IdleTimeout > 24*time.Hour {
		return ErrBadSettings
	}
	w.mu.Lock()
	if err := w.st.SetSetting(settingsKey, s); err != nil {
		w.mu.Unlock()
		return err
	}
	w.settings = s
	w.budgets, w.idle = s.Budgets, s.IdleTimeout
	w.mu.Unlock()
	w.notify(Change{})
	return nil
}

// Pref reads a preference kept with the data, as the executables the
// user chose; ok is false when it is not set.
func (w *Workbench) Pref(key string, v any) (ok bool, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.st.Setting("pref:"+key, v)
}

// SetPref keeps a preference with the data.
func (w *Workbench) SetPref(key string, v any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.st.SetSetting("pref:"+key, v)
}
