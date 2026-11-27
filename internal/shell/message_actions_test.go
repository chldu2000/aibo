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

// The message under the pointer offers to copy it and to quote it in the
// draft; the user's, to put it back in the draft. Not while choosing.
func TestMessageActions(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDelta{ReplyID: "r", Text: "the **reply**"})
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
	hover := func(text string) {
		t.Helper()
		r, ok := tt.Find(text)
		if !ok {
			t.Fatalf("no %q: %q", text, tt.Texts())
		}
		tt.Move(r.X+4, r.Y+r.H/2)
		frame(tt)
	}
	has := func(label string, want bool) {
		t.Helper()
		if _, ok := tt.Find(label); ok != want {
			t.Errorf("%q shown = %v, want %v: %q", label, ok, want, tt.Texts())
		}
	}
	has("复制 #2", false)

	hover("the reply")
	has("复制 #2", true)
	has("引用 #2", true)
	has("放回输入框 #2", false) // the Agent's
	has("复制 #1", false)    // only the one under the pointer
	click(t, tt, "复制 #2")
	if got := tt.Clipboard(); got != "the **reply**" {
		t.Errorf("copied %q", got)
	}
	click(t, tt, "引用 #2")
	if wb.Drafts(s.ID) == nil || !tt.HasText("#2（1 条）") {
		t.Errorf("no reference in the draft: %q", tt.Texts())
	}

	hover("the question")
	has("放回输入框 #1", true)
	click(t, tt, "放回输入框 #1")
	click(t, tt, "复制 #1")
	if got := tt.Clipboard(); got != "the question" {
		t.Errorf("copied %q", got)
	}
	if got := draft(tt); got != "the question" {
		t.Errorf("the draft holds %q", got)
	}

	// Choosing messages, none shows.
	click(t, tt, "选择消息以引用或复制")
	hover("the question")
	has("复制 #1", false)
}

// draft is what the composer's field holds.
func draft(tt *ui.Tester) string {
	for _, a := range tt.AccessAll() {
		if a.Role == ui.RoleTextField && a.Name == "给 假 Agent 发消息" {
			return a.Value
		}
	}
	return "<no composer>"
}
