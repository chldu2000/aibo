package workbench

import (
	"context"
	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"testing"
	"time"
)

type sampleTerminals struct {
	agent.Session
	thread string
	reply  chan map[string]string
}

func (s *sampleTerminals) BackgroundThread() string { return s.thread }
func (s *sampleTerminals) BackgroundTerminals(ctx context.Context) (map[string]string, error) {
	select {
	case items := <-s.reply:
		return items, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestTerminalSnapshotBelongsToCurrentConnection(t *testing.T) {
	a := &sampleTerminals{thread: "a", reply: make(chan map[string]string, 1)}
	b := &sampleTerminals{thread: "b", reply: make(chan map[string]string, 1)}
	w := &Workbench{sessions: map[string]*session{"first": {native: a}, "second": {native: b}}, done: make(chan struct{})}
	defer func() { close(w.done); w.pumps.Wait() }()
	tool := func(thread string) *model.Tool {
		return &model.Tool{NativeThread: thread, NativeItem: "same", Name: "shell"}
	}
	if w.TerminalState("first", tool("a")) != TerminalUnknown || w.TerminalState("second", tool("b")) != TerminalUnknown {
		t.Fatal("pending")
	}
	if w.TerminalState("second", tool("a")) != TerminalUnknown {
		t.Fatal("cross thread")
	}
	b.reply <- map[string]string{}
	until := func(id, thread string, want TerminalState) {
		t.Helper()
		for end := time.Now().Add(2 * time.Second); time.Now().Before(end); {
			if w.TerminalState(id, tool(thread)) == want {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal(id, want)
	}
	until("second", "b", TerminalAbsent)
	fresh := &sampleTerminals{thread: "a", reply: make(chan map[string]string, 1)}
	w.mu.Lock()
	w.sessions["first"].native = fresh
	w.mu.Unlock()
	fresh.reply <- map[string]string{"same": "native-process"}
	until("first", "a", TerminalListed)
	a.reply <- map[string]string{}
	w.mu.Lock()
	w.sessions["first"].native = nil
	w.mu.Unlock()
	if w.TerminalState("first", tool("a")) != TerminalUnknown {
		t.Fatal("stale running status")
	}
}
