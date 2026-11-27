package shell_test

import (
	"context"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// A finished turn leaves how long it took under its reply; a stopped one
// says it was stopped.
func TestTurnSummary(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDelta{ReplyID: turn.Text, Text: "reply to " + turn.Text})
		if turn.Text == "wait" {
			<-ctx.Done()
			return
		}
		emit(agent.ReplyDone{ReplyID: turn.Text})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, 800)
	frame(tt)
	if tt.HasText("用时") {
		t.Fatalf("a time before any turn: %q", tt.Texts())
	}

	wb.Send(s.ID, "hi")
	for wb.Status(s.ID).Running {
		<-changes
	}
	frame(tt)
	if !tt.HasText("reply to hi") || !tt.HasText("用时 ") || tt.HasText("已停止") {
		t.Fatalf("no time after the turn: %q", tt.Texts())
	}

	wb.Send(s.ID, "wait")
	for !tt.HasText("reply to wait") {
		<-changes
		frame(tt)
	}
	if tt.HasText("已停止") {
		t.Fatalf("stopped while running: %q", tt.Texts())
	}
	wb.Stop(s.ID)
	for wb.Status(s.ID).Running {
		<-changes
	}
	frame(tt)
	if !tt.HasText("已停止 · 用时 ") {
		t.Errorf("the stopped turn does not say so: %q", tt.Texts())
	}
}
