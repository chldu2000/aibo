package codex

import (
	"context"
	"encoding/json"
	"github.com/chldu2000/aibo/internal/agent"
	"strings"
)

type historyRPC interface {
	call(context.Context, string, any, any) error
}

// ReadChildPage uses a short-lived read-only client even after an app
// restart. It never attaches to, resumes or runs either native thread.
func (a *Agent) ReadChildPage(ctx context.Context, parent, child, cursor string, limit int) (agent.ChildPage, error) {
	a.mu.Lock()
	path, env, log := a.path, a.env, a.log
	a.mu.Unlock()
	if path == "" {
		return agent.ChildPage{}, agent.ErrNotFound
	}
	if log == nil {
		log = agent.Discard
	}
	srv, err := startServer(ctx, path, env, log, func(*server) {}, nil)
	if err != nil {
		return agent.ChildPage{}, err
	}
	defer srv.stop()
	if srv.version != "0.172.0" {
		return agent.ChildPage{}, agent.ErrChildHistory
	}
	return readChildPage(ctx, srv, parent, child, cursor, limit)
}

func readChildPage(ctx context.Context, rpc historyRPC, parent, child, cursor string, limit int) (agent.ChildPage, error) {
	var meta struct {
		Thread struct{ ID, ParentThreadID string }
	}
	if parent == "" || child == "" || parent == child {
		return agent.ChildPage{}, agent.ErrChildHistory
	}
	if err := rpc.call(ctx, "thread/read", map[string]any{"threadId": child, "includeTurns": false}, &meta); err != nil {
		return agent.ChildPage{}, err
	}
	if meta.Thread.ID != child || meta.Thread.ParentThreadID != parent {
		return agent.ChildPage{}, agent.ErrChildHistory
	}
	params := map[string]any{"threadId": child, "sortDirection": "asc", "itemsView": "full", "limit": max(1, min(limit, 8))}
	if cursor != "" {
		params["cursor"] = cursor
	}
	var res struct {
		Data *[]struct {
			ID, ItemsView string
			Items         []json.RawMessage
		}
		NextCursor string
	}
	if err := rpc.call(ctx, "thread/turns/list", params, &res); err != nil {
		return agent.ChildPage{}, err
	}
	if res.Data == nil || cursor != "" && res.NextCursor == cursor {
		return agent.ChildPage{}, agent.ErrChildHistory
	}
	page := agent.ChildPage{Next: res.NextCursor}
	for _, turn := range *res.Data {
		if turn.ID == "" || turn.ItemsView != "full" {
			return agent.ChildPage{}, agent.ErrChildHistory
		}
		for _, raw := range turn.Items {
			var i struct {
				Type, ID, Text, Command, Prompt string
				Content                         []struct{ Type, Text string }
			}
			// Other native items can have a differently shaped content field.
			if err := json.Unmarshal(raw, &i); err != nil {
				continue
			}
			if i.ID == "" {
				continue
			}
			text := i.Text
			switch i.Type {
			case "agentMessage":
			case "userMessage":
				var parts []string
				for _, part := range i.Content {
					if part.Type == "text" {
						parts = append(parts, part.Text)
					}
				}
				text = strings.Join(parts, "\n")
			case "commandExecution":
				text = i.Command
			case "collabAgentToolCall":
				text = i.Prompt
			default:
				continue
			}
			if text != "" {
				page.Entries = append(page.Entries, agent.HistoryEntry{TurnID: turn.ID, ItemID: i.ID, Kind: i.Type, Text: text})
			}
		}
	}
	return page, nil
}
