package workbench

import (
	"context"
	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"time"
)

type TerminalState int

const (
	TerminalUnknown TerminalState = iota
	TerminalListed
	TerminalAbsent
)

type backgroundRead struct {
	native     agent.Session
	validUntil time.Time
	items      map[string]string
	pending    bool
}

// TerminalState checks a fresh, complete snapshot of this connection only.
// Queries are single-flight. Expiry wakes views once; a closed inspector
// schedules no further reads.
func (w *Workbench) TerminalState(id string, tool *model.Tool) TerminalState {
	if tool == nil || tool.NativeThread == "" || tool.NativeItem == "" {
		return TerminalUnknown
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	sess := w.sessions[id]
	if w.closing || sess == nil {
		return TerminalUnknown
	}
	reader, ok := sess.native.(agent.BackgroundReader)
	if !ok || reader.BackgroundThread() != tool.NativeThread {
		return TerminalUnknown
	}
	r := sess.background
	if r != nil && r.native == sess.native {
		if r.pending {
			return TerminalUnknown
		}
		if time.Now().Before(r.validUntil) {
			if r.items == nil {
				return TerminalUnknown
			}
			if _, ok := r.items[tool.NativeItem]; ok {
				return TerminalListed
			}
			return TerminalAbsent
		}
	}
	r = &backgroundRead{native: sess.native, pending: true}
	sess.background = r
	w.pumps.Add(1)
	go func() {
		defer w.pumps.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		items, err := reader.BackgroundTerminals(ctx)
		cancel()
		w.mu.Lock()
		current := !w.closing && w.sessions[id] == sess && sess.native == r.native && sess.background == r
		if current {
			if err == nil {
				r.items = items
			}
			r.pending = false
			r.validUntil = time.Now().Add(2 * time.Second)
		}
		w.mu.Unlock()
		if !current {
			return
		}
		w.notify(Change{SessionID: id})
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case <-w.done:
			return
		case <-timer.C:
			w.notify(Change{SessionID: id})
		}
	}()
	return TerminalUnknown
}
