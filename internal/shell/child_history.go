package shell

import (
	"context"
	"errors"
	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
	"time"
)

type childHistoryView struct {
	session, activity, next string
	entries                 []agent.HistoryEntry
	seen                    map[[2]string]bool
	cursors                 map[string]bool
	cancel                  context.CancelFunc
	err                     error
}

func (s *Shell) closeChildHistory() {
	if h := s.detail.history; h != nil && h.cancel != nil {
		h.cancel()
	}
	s.detail.history = nil
}

func (h *childHistoryView) appendPage(cursor string, page agent.ChildPage) {
	h.cursors[cursor] = true
	for _, entry := range page.Entries {
		key := [2]string{entry.TurnID, entry.ItemID}
		if !h.seen[key] {
			h.seen[key] = true
			h.entries = append(h.entries, entry)
		}
	}
	h.next = page.Next
	if h.next != "" && h.cursors[h.next] {
		h.err = agent.ErrChildHistory
		h.next = ""
	}
}
func (s *Shell) loadChildPage(h *childHistoryView) {
	if h.cancel != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	h.cancel, h.err = cancel, nil
	id, activity, cursor := h.session, h.activity, h.next
	go func() {
		page, err := s.wb.ChildHistory(ctx, id, activity, cursor)
		if ctx.Err() == context.Canceled {
			return
		}
		cancel()
		s.later(func() {
			if s.detail.history != h {
				return
			}
			h.cancel = nil
			h.err = err
			if err == nil {
				h.appendPage(cursor, page)
			}
		})
	}()
}

func (s *Shell) childPage(c *ui.Context, h *childHistoryView) {
	ui.Text(c, locales.ChildHistoryOpen()).Bold()
	for _, entry := range h.entries {
		c.Key(entry.TurnID + "/" + entry.ItemID)
		label := "Agent"
		switch entry.Kind {
		case "userMessage":
			label = locales.ChildUserMessage()
		case "commandExecution":
			label = locales.CommandHistory()
		case "collabAgentToolCall":
			label = locales.DelegationHistory()
		}
		ui.Text(c, label).FontSize(11).TextColor(c.Theme().TextMuted)
		ui.Text(c, entry.Text).Selectable()
	}
	switch {
	case h.cancel != nil:
		ui.Text(c, locales.WorkspaceLoading()).TextColor(c.Theme().TextMuted)
	case h.err != nil:
		label := locales.ChildHistoryUnavailable()
		if !errors.Is(h.err, agent.ErrChildHistory) {
			label = withDetail(label, s.say(h.err))
		}
		ui.Text(c, label).TextColor(c.Theme().Warning).Selectable()
		if ui.Button(c, locales.ChildHistoryRetry()).Clicked() {
			s.loadChildPage(h)
		}
	case h.next != "":
		if ui.Button(c, locales.ChildHistoryMore()).Clicked() {
			s.loadChildPage(h)
		}
	case len(h.entries) == 0:
		ui.Text(c, locales.NoChildMessages()).TextColor(c.Theme().TextMuted)
	}
}
