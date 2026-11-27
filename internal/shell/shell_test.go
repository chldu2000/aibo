package shell_test

import (
	"context"
	"path/filepath"
	"strings"
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
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
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

// Thinking folds above its reply; tool calls fold into a line with their
// input, a subagent's steps and their result; plans check off their steps.
func TestToolCallsAndPlans(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ThinkingDelta{ReplyID: "m", Text: "先读 go.mod"})
		emit(agent.ReplyDelta{ReplyID: "m", Text: "我来看看。"})
		emit(agent.ReplyDone{ReplyID: "m"})
		emit(agent.PlanUpdated{PlanID: "p", Items: []agent.PlanItem{{Text: "读代码", Status: agent.PlanCompleted}, {Text: "写总结", Status: agent.PlanInProgress}}})
		emit(agent.ToolStarted{ToolID: "t", Name: "Read", Input: []byte(`{"file_path":"go.mod"}`)})
		emit(agent.ToolFinished{ToolID: "t", Output: "module example.com/x"})
		emit(agent.ToolStarted{ToolID: "a", Name: "Agent", Input: []byte(`{"description":"数文件","prompt":"..."}`)})
		emit(agent.ToolStarted{ToolID: "c", Parent: "a", Name: "Bash", Input: []byte(`{"command":"ls | wc -l"}`)})
		emit(agent.ToolFinished{ToolID: "c", Parent: "a", Output: "3"})
		emit(agent.ToolFinished{ToolID: "a", Output: "3 个文件"})
		emit(agent.ToolStarted{ToolID: "big", Name: "Bash", Input: []byte(`{"command":"cat big.log"}`)})
		emit(agent.ToolFinished{ToolID: "big", Output: strings.Repeat("一行日志\n", 2000), IsError: true})
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
	wb.Send(s.ID, "看看")
	for wb.Status(s.ID).Running {
		<-changes
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 1400)
	settle := func() {
		for i := 0; i < 4; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	settle()
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		settle()
	}
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}
	// The calls that went well fold into a line; the failed one stays.
	shows("我来看看。", "思考", "计划", "读代码", "写总结", "2 个工具调用", "读了 1 个文件 · 1 个子 Agent", "Bash · cat big.log · 出错")
	if tt.HasText("Read · go.mod") {
		t.Error("the group shows its calls folded")
	}
	if tt.HasText("先读 go.mod") || tt.HasText("module example.com/x") {
		t.Error("folded content shows")
	}
	click("思考")
	shows("先读 go.mod")
	click("2 个工具调用")
	click(startingWith(tt, "逐条列出"))
	click("Read · go.mod")
	shows("参数", "结果", "module example.com/x")
	click("Agent · 数文件 · 子代理 1 步")
	shows("Bash · ls | wc -l")
	click("Bash · cat big.log · 出错")
	shows("结果（出错）")
}

// named is a fake Agent of another kind and name.
type named struct {
	*fake.Agent
	kind agent.Kind
	name string
}

func (n named) Kind() agent.Kind { return n.kind }

func (n named) Name() string { return n.name }

// With several Agents, "+" asks which one starts the session.
func TestNewSessionChoosesAgent(t *testing.T) {
	quiet := func(context.Context, agent.StartOptions, agent.Turn, func(agent.Event)) {}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{
		named{fake.New(quiet), "alpha", "Alpha"}, named{fake.New(quiet), "beta", "Beta"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 760)
	tt.Frame()
	if err := tt.Click("在 " + filepath.Base(ws.Path) + " 新建会话"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if len(wb.Sessions()) != 0 {
		t.Fatal("a session started before an Agent was chosen")
	}
	if err := tt.Click("用 Beta 新建会话"); err != nil {
		t.Fatalf("%v: %q", err, tt.Texts())
	}
	tt.Frame()
	got := wb.Sessions()
	if len(got) != 1 || got[0].Agent != "beta" || got[0].Model != "" {
		t.Fatalf("sessions = %+v", got)
	}
	if !tt.HasText("给 Beta 发消息") || tt.HasText("用 Alpha 新建会话") {
		t.Errorf("after choosing: %q", tt.Texts())
	}
}
