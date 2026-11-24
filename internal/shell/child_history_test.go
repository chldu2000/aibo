package shell

import (
	"github.com/chldu2000/aibo/internal/agent"
	"testing"
)

func TestChildHistoryDeduplicatesOverlappingPages(t *testing.T) {
	h := &childHistoryView{seen: map[[2]string]bool{}, cursors: map[string]bool{}}
	a := agent.HistoryEntry{TurnID: "first", ItemID: "message", Text: "first"}
	b := agent.HistoryEntry{TurnID: "second", ItemID: "message", Text: "second"}
	h.appendPage("", agent.ChildPage{Entries: []agent.HistoryEntry{a}, Next: "opaque"})
	h.appendPage("opaque", agent.ChildPage{Entries: []agent.HistoryEntry{a, b}, Next: "opaque"})
	if len(h.entries) != 2 || h.entries[1] != b || h.next != "" || h.err == nil {
		t.Fatal(h)
	}
}
