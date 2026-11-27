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

// A session that replied behind another gets a blue dot, which opening
// it clears; its row says when it was last active.
func TestSessionRowUnread(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "done behind"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	ws, _ := wb.AddWorkspace(t.TempDir())
	back, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(back.ID, "behind")
	front, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(front.ID, "in front")
	sh := shell.New(wb, shell.Options{})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1100, 800)
	frame(tt)
	click(t, tt, "in front")
	if tt.HasText("有新消息") {
		t.Fatalf("unread before anything: %q", tt.Texts())
	}

	wb.Send(back.ID, "go")
	for wb.Status(back.ID).Running {
		<-changes
	}
	frame(tt)
	if !tt.HasText("有新消息") {
		t.Fatalf("no blue dot after the turn behind: %q", tt.Texts())
	}
	if !tt.HasText("刚刚") {
		t.Errorf("the row does not say when: %q", tt.Texts())
	}
	click(t, tt, "behind")
	if tt.HasText("有新消息") {
		t.Errorf("the dot stays once opened: %q", tt.Texts())
	}
}

// Minimized, the window shows no session: the open one that ends a turn
// is unread until the window comes back.
func TestUnreadWhileAway(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "done"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	sh := shell.New(wb, shell.Options{Only: x.ID})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1000, 700)
	frame(tt)

	turn := func() {
		t.Helper()
		wb.Send(x.ID, "go")
		for wb.Status(x.ID).Running {
			<-changes
		}
	}
	turn()
	if wb.Status(x.ID).Unread {
		t.Fatal("the session shown is unread")
	}
	sh.SetVisible(false)
	turn()
	if !wb.Status(x.ID).Unread {
		t.Error("a turn behind the minimized window is read")
	}
	sh.SetVisible(true)
	if wb.Status(x.ID).Unread {
		t.Error("the window back, it stays unread")
	}
}
