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

// Compacting shows as a line across the session; slash commands are
// refused; a session can reference its own messages.
func TestCompactionSlashAndSelfReference(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "回复：" + turn.Text})
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
	wb.Send(s.ID, "暗号是 kestrel")
	for wb.Status(s.ID).Running {
		<-changes
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 900)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	frame()
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}

	click("会话的更多操作")
	if err := tt.ChooseMenuItem("压缩上下文"); err != nil {
		t.Fatal(err)
	}
	frame()
	for wb.Status(s.ID).Running || len(wb.Markers(s.ID)) == 0 {
		<-changes
	}
	frame()
	shows("上下文已压缩 · 手动 · 1.0k → 100 tokens")

	click("给 假 Agent 发消息")
	tt.Type("/clear")
	tt.Key(0, ui.KeyEnter)
	frame()
	shows("“/clear”不是 假 Agent 的可用命令。想原样发给模型，请在开头加一个空格。")
	if ms, _ := wb.Messages(s.ID); len(ms) != 2 {
		t.Errorf("a slash command was sent: %+v", ms)
	}

	click("选择消息以引用或复制")
	click("选中整个会话")
	click("发给…")
	click("引用给本会话")
	shows("这是本会话较早的一段内容，你的上下文中可能已不再保留其细节。当用户的请求依赖其中的内容时，")
	click("引用")
	shows("本会话 · #1–#2（2 条）")
}

// A native session that cannot be resumed shows why, in the Agent's
// words, and what can be done; a new one is marked in the session.
func TestResumeFailureBanner(t *testing.T) {
	dir := t.TempDir()
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "好的"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	wb.Send(s.ID, "定个方案")
	for wb.Status(s.ID).Running {
		<-changes
	}
	wb.Close()

	f := fake.New(respond)
	f.FailResumes("No conversation found with session ID: x")
	wb, err = workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 900)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	frame()
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}

	click("给 假 Agent 发消息")
	tt.Type("继续")
	tt.Key(0, ui.KeyEnter)
	frame()
	shows("无法续接原生会话", "No conversation found with session ID: x", "原生会话无法续接，请先在上方选择怎么处理")
	click("暂不处理")
	shows("会话只读：原生会话无法续接")
	if tt.HasText("暂不处理") {
		t.Error("read-only still offers to leave it")
	}
	click("新开原生会话并引用之前的内容（推荐）")
	if tt.HasText("原生会话无法续接") {
		t.Errorf("the banner stayed: %q", tt.Texts())
	}
	shows("上下文已重置：Agent 换了新的原生会话", "本会话 · #1–#2（2 条）", "给 假 Agent 发消息")
}
