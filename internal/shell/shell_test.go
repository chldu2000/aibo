package shell_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// Through the real window, on the real core with the fake Agent: add a
// workspace, create a session, send a message, see the reply, and find
// it all again after a restart.
func TestFirstConversation(t *testing.T) {
	dataDir, project := t.TempDir(), t.TempDir()
	release := make(chan struct{})
	respond := func(ctx context.Context, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDelta{ReplyID: "r", Text: "你好，"})
		select {
		case <-release:
		case <-ctx.Done():
			return
		}
		emit(agent.ReplyDelta{ReplyID: "r", Text: "我是假 Agent"})
		emit(agent.ReplyDone{ReplyID: "r"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: dataDir, Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	sh := shell.New(wb, shell.Options{ChooseFolder: func() (string, bool) { return project, true }})
	tt := ui.NewTester(sh.View, 1100, 760)

	// waitFor shows frames, advancing the Tester's clock, at whose pace
	// Stream reveals text, until the window shows text. It waits for the
	// workbench only once the window has no frame left to show.
	waitFor := func(text string) {
		t.Helper()
		guard := time.After(time.Minute)
		for {
			tt.Frame()
			tt.Advance(time.Second)
			if tt.HasText(text) {
				return
			}
			if tt.FramePending() {
				continue
			}
			select {
			case <-changes:
			case <-guard:
				t.Fatalf("the window never showed %q; it shows %q", text, tt.Texts())
			}
		}
	}

	if !tt.HasText("还没有工作区") {
		t.Fatalf("no empty state: %q", tt.Texts())
	}
	if err := tt.Click("添加工作区…"); err != nil {
		t.Fatal(err)
	}
	name := filepath.Base(project)
	waitFor(name)
	if err := tt.Click("在 " + name + " 新建会话"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if !tt.HasText("发一条消息开始对话") {
		t.Fatalf("new session not open: %q", tt.Texts())
	}
	if err := tt.Click("给 假 Agent 发消息"); err != nil {
		t.Fatal(err)
	}
	tt.Type("帮我看看这个项目")
	tt.Key(0, ui.KeyEnter)
	waitFor("你好")
	if !tt.HasText("帮我看看这个项目") {
		t.Errorf("the user's message is not shown: %q", tt.Texts())
	}
	if !tt.Focused("停止") && !tt.HasText("运行中") {
		t.Errorf("no sign of the running turn: %q", tt.Texts())
	}
	close(release)
	waitFor("我是假 Agent")
	for wb.Status(wb.Sessions()[0].ID).Running {
		<-changes
	}
	wb.Close()

	// After a restart the sidebar and the conversation are back.
	wb2, err := workbench.Open(workbench.Options{DataDir: dataDir, Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb2.Close()
	tt2 := ui.NewTester(shell.New(wb2, shell.Options{}).View, 1100, 760)
	for _, want := range []string{name, "帮我看看这个项目", "我是假 Agent"} {
		if !tt2.HasText(want) {
			t.Errorf("after restart the window lacks %q: %q", want, tt2.Texts())
		}
	}
}
