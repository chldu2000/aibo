package shell_test

import (
	"context"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// Copying says so for a moment, where it was clicked: the message's copy
// button shows a check, the selection's says it copied. Their labels stay.
func TestCopyFeedback(t *testing.T) {
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
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, 800)
	frame(tt)
	// press clicks label and draws a frame, no time passing.
	press := func(label string) {
		t.Helper()
		if err := tt.Click(label); err != nil {
			t.Fatalf("%v: %q", err, tt.Texts())
		}
		tt.Frame()
		tt.Frame()
	}
	// checked reports whether a check shows, by its symbol.
	checked := func() bool { _, ok := tt.Find("checkmark"); return ok }

	r, ok := tt.Find("the reply")
	if !ok {
		t.Fatalf("no reply: %q", tt.Texts())
	}
	tt.Move(r.X+4, r.Y+r.H/2)
	frame(tt)
	if checked() {
		t.Fatalf("a check before copying: %q", tt.Texts())
	}
	press("复制 #2")
	if got := tt.Clipboard(); got != "the reply" {
		t.Errorf("copied %q", got)
	}
	if !checked() {
		t.Errorf("no check after copying: %q", tt.Texts())
	}
	if _, ok := tt.Find("复制 #2"); !ok {
		t.Errorf("the button lost its label: %q", tt.Texts())
	}
	tt.Advance(2 * time.Second)
	tt.Frame()
	if checked() {
		t.Errorf("the check stays: %q", tt.Texts())
	}

	click(t, tt, "选择消息以引用或复制")
	click(t, tt, "选中整个会话")
	press("复制")
	if got := tt.Clipboard(); got == "the reply" || got == "" {
		t.Errorf("the selection copied %q", got)
	}
	if !tt.HasText("已复制") {
		t.Errorf("the selection does not say it copied: %q", tt.Texts())
	}
	tt.Advance(2 * time.Second)
	tt.Frame()
	if tt.HasText("已复制") {
		t.Errorf("the selection still says it copied: %q", tt.Texts())
	}
}
