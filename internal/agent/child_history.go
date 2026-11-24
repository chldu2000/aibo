package agent

import (
	"context"
	"errors"
)

var ErrChildHistory = errors.New("child history unavailable")

type HistoryEntry struct{ TurnID, ItemID, Kind, Text string }
type ChildPage struct {
	Entries []HistoryEntry
	Next    string
}

// ChildHistoryReader verifies the child's direct parent before reading
// each page. The opaque cursor belongs to the selected child.
type ChildHistoryReader interface {
	ReadChildPage(ctx context.Context, parent, child, cursor string, limit int) (ChildPage, error)
}
