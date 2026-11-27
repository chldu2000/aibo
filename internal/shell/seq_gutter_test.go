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

// The messages' numbers take no room until needed: one shows over its
// message under the pointer; all do, in a column, to choose a range or
// beside the one highlighted.
func TestSeqGutter(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDelta{ReplyID: "r", Text: "the reply"})
		emit(agent.ReplyDone{ReplyID: "r"})
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
	wb.Send(s.ID, "the question")
	for wb.Status(s.ID).Running {
		<-changes
	}
	sh := shell.New(wb, shell.Options{Only: s.ID})
	tt := ui.NewTester(sh.View, 1100, 800)
	frame(tt)
	numbers := func(want bool) {
		t.Helper()
		if tt.HasText("#1") != want || tt.HasText("#2") != want {
			t.Fatalf("numbers shown = %v, want %v: %q", !want, want, tt.Texts())
		}
	}
	left := func() float32 {
		t.Helper()
		r, ok := tt.Find("the reply")
		if !ok {
			t.Fatalf("no reply: %q", tt.Texts())
		}
		return r.X
	}
	numbers(false)
	bare := left()

	// Under the pointer, its number shows, and nothing moves.
	r, _ := tt.Find("the reply")
	tt.Move(r.X+r.W/2, r.Y+r.H/2)
	frame(tt)
	if !tt.HasText("#2") || tt.HasText("#1") {
		t.Errorf("hovering the reply shows %q", tt.Texts())
	}
	if x := left(); x != bare {
		t.Errorf("the reply moved from %v to %v", bare, x)
	}
	tt.Move(5, 5)
	frame(tt)
	numbers(false)

	// Choosing a range, all show in their column, left of the messages,
	// which stay where they are while the window has room for it.
	click(t, tt, "选择消息以引用或复制")
	numbers(true)
	if x := left(); x != bare {
		t.Errorf("the messages moved from %v to %v", bare, x)
	}
	if r, _ := tt.Find("#2"); r.X+r.W > bare {
		t.Errorf("the number (to %v) is not left of the message (from %v)", r.X+r.W, bare)
	}
	// Narrow, it takes room from the messages.
	tt.SetSize(640, 800)
	frame(tt)
	narrow := left()
	click(t, tt, "取消")
	if x := left(); narrow < x+40 {
		t.Errorf("in a narrow window the column takes no room: %v, bare %v", narrow, x)
	}
	tt.SetSize(1100, 800)
	frame(tt)
	numbers(false)

	// The messages center: a window 400 wider moves them 200.
	tt.SetSize(1500, 800)
	frame(tt)
	if x := left(); x < bare+196 || x > bare+204 {
		t.Errorf("400 wider, the messages moved from %v to %v, want about %v", bare, x, bare+200)
	}
	tt.SetSize(1100, 800)
	frame(tt)

	// Esc leaves the targets first, then selection mode.
	click(t, tt, "选择消息以引用或复制")
	click(t, tt, "选中整个会话")
	click(t, tt, "发给…")
	targets := len(tt.Texts())
	tt.Key(0, ui.KeyEscape)
	frame(tt)
	if !tt.HasText("取消") || len(tt.Texts()) >= targets {
		t.Errorf("Esc did not close the targets alone: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyEscape)
	frame(tt)
	numbers(false)
	if tt.HasText("取消") {
		t.Errorf("Esc did not leave selection mode: %q", tt.Texts())
	}

	// So with a range highlighted.
	sh.Reveal(s.ID, 1, 1)
	frame(tt)
	numbers(true)
}
