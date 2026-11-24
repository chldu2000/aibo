package codex

import (
	"context"
	"errors"
)

// Only enable the version exercised by the sidebar protocol contracts.
func (s *session) BackgroundThread() string {
	if s.srv.version != "0.172.0" {
		return ""
	}
	return s.id
}
func (s *session) BackgroundTerminals(ctx context.Context) (map[string]string, error) {
	if s.BackgroundThread() == "" {
		return nil, errors.New("unsupported background terminal list")
	}
	items := map[string]string{}
	cursor := ""
	for range 32 {
		params := map[string]any{"threadId": s.id, "limit": 64}
		if cursor != "" {
			params["cursor"] = cursor
		}
		var page struct {
			Data *[]struct {
				ItemID    string `json:"itemId"`
				ProcessID string `json:"processId"`
			} `json:"data"`
			NextCursor string `json:"nextCursor"`
		}
		if err := s.srv.call(ctx, "thread/backgroundTerminals/list", params, &page); err != nil {
			return nil, err
		}
		if page.Data == nil {
			return nil, errors.New("missing terminal snapshot")
		}
		for _, i := range *page.Data {
			if i.ItemID == "" || i.ProcessID == "" {
				return nil, errors.New("incomplete terminal identity")
			}
			items[i.ItemID] = i.ProcessID
		}
		if page.NextCursor == "" {
			return items, nil
		}
		if page.NextCursor == cursor {
			break
		}
		cursor = page.NextCursor
	}
	return nil, errors.New("incomplete terminal pagination")
}
