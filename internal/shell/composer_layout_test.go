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

// However tall the composer and what floats above it grow, the last
// message shows above them; the draft grows to 40% of the window, then
// scrolls.
func TestComposerClearance(t *testing.T) {
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
	for i := 1; i <= 12; i++ {
		wb.Send(x.ID, fmt.Sprintf("消息 %d", i))
		for wb.Status(x.ID).Running {
			<-changes
		}
	}
	// A banner above the composer.
	wb.SetArchived(x.ID, true)

	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1000, 800)
	frame(tt)
	prompt := locales.MessageAgent("假 Agent")
	click(t, tt, prompt)
	for range 8 {
		tt.Type("一行")
		tt.Key(ui.Shift, ui.KeyEnter)
	}
	frame(tt)
	frame(tt)

	find := func(label string) ui.Rect {
		t.Helper()
		r, ok := tt.Find(label)
		if !ok {
			t.Fatalf("no %q: %q", label, tt.Texts())
		}
		return r
	}
	last, banner := find("回复：消息 12"), find(locales.ArchivedNote())
	if last.Y+last.H > banner.Y {
		t.Errorf("the last message (to y=%v) is under the composer (from y=%v)", last.Y+last.H, banner.Y)
	}

	for range 60 {
		tt.Type("又一行")
		tt.Key(ui.Shift, ui.KeyEnter)
	}
	frame(tt)
	if r := find(prompt); r.H > 800*0.4+1 {
		t.Errorf("the draft grew to %v, past 40%% of the window", r.H)
	}
	last, banner = find("回复：消息 12"), find(locales.ArchivedNote())
	if last.Y+last.H > banner.Y {
		t.Errorf("with a long draft, the last message (to y=%v) is under the composer (from y=%v)", last.Y+last.H, banner.Y)
	}
}
