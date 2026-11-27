package shell_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// Scrolled up from the end, the messages show a button back to it,
// marked once more came below; it and ⌘↓ go back there.
func TestJumpToEnd(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "回复：" + turn.Text})
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
	send := func(text string) {
		wb.Send(x.ID, text)
		for wb.Status(x.ID).Running {
			<-changes
		}
	}
	for i := 1; i <= 20; i++ {
		send(fmt.Sprintf("消息 %d", i))
	}

	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1000, 800)
	frame(tt)
	jump, fresh := locales.JumpToEnd(), locales.NewBelow()
	none := func(when string) {
		t.Helper()
		if tt.HasText(jump) || tt.HasText(fresh) {
			t.Errorf("%s, the button shows: %q", when, tt.Texts())
		}
	}
	shows := func(label, when string) {
		t.Helper()
		if !tt.HasText(label) {
			t.Errorf("%s, no %q: %q", when, label, tt.Texts())
		}
	}
	none("at the end")

	tt.Scroll(600, 400, 0, -600)
	frame(tt)
	shows(jump, "scrolled up")
	if tt.HasText("回复：消息 20") {
		t.Fatalf("did not scroll: %q", tt.Texts())
	}

	send("消息 21")
	frame(tt)
	shows(fresh, "after a reply came below")

	click(t, tt, fresh)
	frame(tt)
	none("back at the end")
	shows("回复：消息 21", "back at the end")

	// ⌘↓, the focus out of the composer.
	tt.Scroll(600, 400, 0, -600)
	frame(tt)
	shows(jump, "scrolled up again")
	tt.Key(ui.Super, ui.KeyDown)
	frame(tt)
	none("after ⌘↓")

	// In the composer, ⌘↓ moves the caret, and stays there.
	click(t, tt, locales.MessageAgent("假 Agent"))
	tt.Scroll(600, 400, 0, -600)
	frame(tt)
	tt.Key(ui.Super, ui.KeyDown)
	frame(tt)
	shows(jump, "after ⌘↓ in the composer")
}
