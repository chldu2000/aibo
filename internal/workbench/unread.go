package workbench

import (
	"strings"

	"github.com/chldu2000/aibo/internal/model"
)

// Viewing says which session a window shows now, "" for none; viewer
// names the window, as each reports its own. A session some window shows
// is read; one that ends a turn or asks for approval while none does is
// unread until one does. Unread is not kept across launches.
func (w *Workbench) Viewing(viewer, id string) {
	w.mu.Lock()
	if id == "" {
		delete(w.viewing, viewer)
	} else {
		w.viewing[viewer] = id
	}
	s, read := w.sessions[id]
	read = read && s.unread
	if read {
		s.unread = false
	}
	w.mu.Unlock()
	if read {
		w.notify(Change{SessionID: id})
	}
}

// attention marks a session unread when no window shows it: it ended a
// turn, or asks for something. w.mu is held.
func (w *Workbench) attention(id string, s *session) {
	for _, shown := range w.viewing {
		if shown == id {
			return
		}
	}
	s.unread = true
}

// LastWords is the last thing said in a session, the user's words or the
// Agent's, for a glance at it; "" when nothing was.
func (w *Workbench) LastWords(id string) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[id]
	if !ok || w.load(id, s) != nil {
		return ""
	}
	for i := len(s.msgs) - 1; i >= 0; i-- {
		m := s.msgs[i]
		if (m.Kind == model.UserMessage || m.Kind == model.AgentReply) && strings.TrimSpace(m.Text) != "" {
			return m.Text
		}
	}
	return ""
}
