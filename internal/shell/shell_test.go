package shell_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
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

// Through the real window: push a whole session as a reference to another
// session, send it, see the Agent read it, and jump back to what it read.
func TestPushReference(t *testing.T) {
	respond := func(ctx context.Context, opts agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		reply := "好的"
		if m := regexp.MustCompile(`id="(ref_\w+)"`).FindStringSubmatch(turn.Text); m != nil {
			if _, isErr, err := fake.CallTool(ctx, opts.MCP, "read_reference", map[string]any{"ref_id": m[1]}); err != nil || isErr {
				reply = "读取失败"
			} else {
				reply = "已读取引用"
			}
		}
		emit(agent.ReplyDelta{ReplyID: "r", Text: reply})
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
	target, _ := wb.NewSession(ws.ID, fake.Kind, "")
	src, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(src.ID, "数据库迁移方案")
	for wb.Status(src.ID).Running {
		<-changes
	}

	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 760)
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
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		tt.Frame()
	}

	// The most recent session, the source, is open.
	waitFor("好的")
	click("选择消息以引用或复制")
	click("选中整个会话")
	waitFor("已选 #1–#2 · 2 条")
	click("发给…")
	click("引用给 新会话")
	waitFor("接收方 Agent 会收到下面的概要") // the preview
	if !tt.HasText("- 范围：#1–#2，共 2 条消息") {
		t.Errorf("the preview lacks the range: %q", tt.Texts())
	}
	click("引用")
	if wb.Drafts(target.ID) == nil {
		t.Fatal("no draft after confirming")
	}
	label := "假 Agent · 数据库迁移方案 · #1–#2（2 条）"
	waitFor(label) // the draft chip, in the target's composer
	click("给 假 Agent 发消息")
	tt.Key(0, ui.KeyEnter) // references alone can be sent
	waitFor("已读取引用")
	waitFor("Agent 读取了 #1–#2")
	click("查看概要")
	waitFor(`<aibo-reference id="`)
	click("在源会话中查看")
	waitFor("已高亮被引用的范围 #1–#2")
	if !tt.HasText("数据库迁移方案") {
		t.Errorf("the source is not open: %q", tt.Texts())
	}
}

// Selection mode: click, Shift-click, gaps filled, whole turns, copy,
// and a reference to a new session.
func TestSelectAndReferenceToNewSession(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDelta{ReplyID: "r", Text: strings.Replace(turn.Text, "问题", "回答", 1)})
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
	src, _ := wb.NewSession(ws.ID, fake.Kind, "")
	for _, q := range []string{"问题一", "问题二", "问题三"} {
		wb.Send(src.ID, q)
		for wb.Status(src.ID).Running {
			<-changes
		}
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 900)
	for i := 0; i < 5; i++ {
		tt.Frame()
		tt.Advance(time.Second)
	}
	click := func(mods ui.Modifiers, s string) {
		t.Helper()
		if err := tt.ClickWith(mods, s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		tt.Frame()
	}
	// row clicks where a message's number shows, which takes no input
	// itself in selection mode: the row under it does.
	row := func(mods ui.Modifiers, seq string) {
		t.Helper()
		r, ok := tt.Find(seq)
		if !ok {
			t.Fatalf("no %s in %q", seq, tt.Texts())
		}
		tt.ClickAtWith(mods, r.X+r.W/2, r.Y+r.H/2)
		tt.Frame()
	}
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}

	click(0, "选择消息以引用或复制")
	shows("点击消息设起点")
	row(0, "#3")
	shows("已选 #3 · 1 条")
	row(ui.Shift, "#6")
	shows("已选 #3–#6 · 4 条")
	if tt.HasText("已补齐中间的消息") {
		t.Error("a contiguous choice says it was filled")
	}
	row(0, "#1")
	row(ui.Super, "#4") // leaving a gap
	shows("已选 #1–#4 · 4 条", "已补齐中间的消息")
	row(0, "#4") // alone
	click(0, "选中整轮")
	shows("已选 #3–#4 · 2 条")
	if tt.HasText("已补齐中间的消息") {
		t.Error("the note outlived the gap")
	}
	click(0, "复制")
	if got := tt.Clipboard(); got != "### [3] 用户\n\n问题二\n\n### [4] 假 Agent\n\n回答二\n" {
		t.Errorf("clipboard = %q", got)
	}

	click(0, "发给…")
	click(0, "引用给 "+filepath.Base(ws.Path)+" 的新 假 Agent 会话")
	shows("- 范围：#3–#4，共 2 条消息", "- 首条用户消息：#3「问题二」")
	click(0, "引用")
	all := wb.Sessions()
	if len(all) != 2 {
		t.Fatalf("%d sessions, want the new one", len(all))
	}
	var created string
	for _, x := range all {
		if x.ID != src.ID {
			created = x.ID
		}
	}
	d := wb.Drafts(created)
	if len(d) != 1 || d[0].From != 3 || d[0].To != 4 {
		t.Fatalf("drafts of the new session = %+v", d)
	}
	shows("假 Agent · 问题一 · #3–#4（2 条）") // its chip, in the new session's composer
}

// Pulling from the receiver: "@" opens the panel, which finds a session in
// another workspace, chooses a range on its timeline with the brief beside
// it, and inserts the reference next to what the user typed.
func TestPullReferenceWithAt(t *testing.T) {
	var got []string
	var mu sync.Mutex
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		mu.Lock()
		got = append(got, turn.Text)
		mu.Unlock()
		emit(agent.ReplyDelta{ReplyID: "r", Text: strings.Replace(turn.Text, "问", "答", 1)})
		emit(agent.ReplyDone{ReplyID: "r"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	other, _ := wb.AddWorkspace(t.TempDir())
	src, _ := wb.NewSession(other.ID, fake.Kind, "")
	for _, q := range []string{"问：迁移的风险", "问：时区", "问：方案"} {
		wb.Send(src.ID, q)
		for wb.Status(src.ID).Running {
			<-changes
		}
	}
	home, _ := wb.AddWorkspace(t.TempDir())
	wb.NewSession(home.ID, fake.Kind, "") // the newest: open at start
	sh := shell.New(wb, shell.Options{})
	tt := ui.NewTester(sh.View, 1100, 800)
	tt.Frame()
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		tt.Frame()
	}
	row := func(mods ui.Modifiers, seq string) {
		t.Helper()
		r, ok := tt.Find(seq)
		if !ok {
			t.Fatalf("no %s in %q", seq, tt.Texts())
		}
		tt.ClickAtWith(mods, r.X+r.W/2, r.Y+r.H/2)
		tt.Frame()
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
	tt.Type("按这个写 @")
	tt.Frame()
	shows("引用其他会话")
	tt.Type("迁移") // the search has the focus
	tt.Frame()
	if tt.HasText("选择 新会话") {
		t.Error("the search lists the receiving session itself")
	}
	click("选择 问：迁移的风险")
	shows("点击消息设起点，Shift+点击设终点", "选好范围后，这里显示概要。")
	row(0, "#3")
	row(ui.Shift, "#4")
	shows("已选 #3–#4 · 2 条", "- 范围：#3–#4，共 2 条消息", "- 源工作区："+other.Path)
	click("插入引用")
	if tt.HasText("插入引用") {
		t.Fatal("the panel stayed open")
	}
	shows("假 Agent · 问：迁移的风险 · #3–#4（2 条）")

	// The "@" did not stay in the draft; the rest did.
	// The composer has the focus back: Enter sends.
	tt.Key(0, ui.KeyEnter)
	guard := time.After(time.Minute)
	for {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n == 4 {
			break
		}
		select {
		case <-changes:
		case <-guard:
			t.Fatalf("Enter sent nothing; the window shows %q", tt.Texts())
		}
	}
	mu.Lock()
	last := got[3]
	mu.Unlock()
	if !strings.HasSuffix(last, "</aibo-reference>\n\n按这个写") || strings.Contains(last, "@") {
		t.Errorf("the Agent received %q", last)
	}

	// The @ button opens the panel too, and Back returns to the search.
	tt.Frame()
	click("引用其他会话（@）")
	click("选择 问：迁移的风险")
	click("返回搜索")
	shows("选择 问：迁移的风险")
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
	shows("我来看看。", "思考", "计划", "读代码", "写总结", "Read · go.mod", "Agent · 数文件 · 子代理 1 步", "Bash · cat big.log · 出错")
	if tt.HasText("先读 go.mod") || tt.HasText("module example.com/x") {
		t.Error("folded content shows")
	}
	click("思考")
	shows("先读 go.mod")
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
func (n named) Name() string     { return n.name }

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
	for i := 0; i < 50 && !tt.HasText("使用模型 默认"); i++ {
		time.Sleep(10 * time.Millisecond) // the models load off the main thread
		tt.Frame()
	}
	if err := tt.Click("使用模型 默认"); err != nil {
		t.Fatalf("%v: %q", err, tt.Texts())
	}
	tt.Frame()
	got := wb.Sessions()
	if len(got) != 1 || got[0].Agent != "beta" {
		t.Fatalf("sessions = %+v", got)
	}
	if !tt.HasText("给 Beta 发消息") || tt.HasText("用 Alpha 新建会话") {
		t.Errorf("after choosing: %q", tt.Texts())
	}
}

// An approval card shows what is asked and answers with the Agent's own
// options: a permanent rule asks again first, a denial can say why.
func TestApprovalCard(t *testing.T) {
	var f *fake.Agent
	got := make(chan fake.Decision, 4)
	opts := []agent.ApprovalOption{
		{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"},
		{ID: "session", Kind: agent.AllowSession, Label: "本会话内始终允许"},
		{ID: "always", Kind: agent.AllowAlways, Label: "永久允许（Write）", Where: ".claude/settings.local.json"},
		{ID: "no", Kind: agent.Deny, Label: "拒绝"},
		{ID: "stop", Kind: agent.DenyStop, Label: "拒绝并停止"},
	}
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		for i, p := range []string{"/etc/hosts", "notes.txt"} {
			id := fmt.Sprint(i)
			emit(agent.ToolStarted{ToolID: id, Name: "Write", Input: []byte(`{"file_path":"` + p + `"}`)})
			emit(agent.ApprovalRequested{ID: "ap" + id, ToolID: id, Title: "修改文件", Paths: []string{p}, Diff: "--- " + p + "\n+++ " + p + "\n-old line\n+new line", Options: opts})
			select {
			case d := <-f.Decisions():
				got <- d
				emit(agent.ToolFinished{ToolID: id, Output: "ok"})
			case <-ctx.Done():
				return
			}
		}
	}
	f = fake.New(respond)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "改两个文件")
	for wb.Status(s.ID).Approvals == 0 {
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
	shows("需要审批 · 修改文件", "写入其他工作区", "-old line", "+new line", "批准本次", "本会话内始终允许", "拒绝并停止")

	click("永久允许（Write）…")
	shows("将写入 .claude/settings.local.json，以后同类操作不再询问。确定吗？")
	click("取消")
	click("拒绝…")
	tt.Type("不能改系统文件")
	click("确定拒绝")
	if d := <-got; d.ID != "ap0" || d.OptionID != "no" || d.Note != "不能改系统文件" {
		t.Errorf("decision = %+v", d)
	}
	for wb.Status(s.ID).Approvals == 0 {
		<-changes
	}
	frame()
	shows("审批：拒绝（不能改系统文件）")
	if tt.HasText("写入其他工作区") {
		t.Error("notes.txt is inside the workspace")
	}
	click("批准本次")
	if d := <-got; d.ID != "ap1" || d.OptionID != "once" {
		t.Errorf("decision = %+v", d)
	}
	for wb.Status(s.ID).Running {
		<-changes
	}
	frame()
	shows("审批：批准本次")
}

// The composer's approval control sets the level (full auto after asking
// again, then warned of) and lists the session's rules to revoke; a
// session waiting in the background shows in the sidebar and notifies.
func TestApprovalLevelsRulesAndNotifications(t *testing.T) {
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "t", Name: "Bash", Input: []byte(`{"command":"go test ./..."}`)})
		emit(agent.ApprovalRequested{ID: "a-" + turn.Text, ToolID: "t", Title: "执行命令", Command: "go test ./...", Options: []agent.ApprovalOption{
			{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"},
			{ID: "session", Kind: agent.AllowSession, Label: "本会话内始终允许（go test）", Rules: []agent.Rule{{Label: "命令 go test ./...", Data: []byte(`{}`)}}},
		}})
		select {
		case <-f.Decisions():
			emit(agent.ToolFinished{ToolID: "t", Output: "ok"})
		case <-ctx.Done():
		}
	}
	f = fake.New(respond)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(t.TempDir())
	back, _ := wb.NewSession(ws.ID, fake.Kind, "")
	front, _ := wb.NewSession(ws.ID, fake.Kind, "")
	var notes []string
	sh := shell.New(wb, shell.Options{Notify: func(id, title, body string) { notes = append(notes, id+"|"+title+"|"+body) }})
	tt := ui.NewTester(sh.View, 1100, 900)
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
	level := func() agent.ApprovalLevel { x, _ := wb.Session(front.ID); return x.Level }

	click("审批档位：每次询问")
	click("自动接受工作区内修改")
	if level() != agent.AcceptEdits {
		t.Fatalf("level = %q", level())
	}
	click("审批档位：自动接受工作区内修改")
	click("全部自动")
	if level() != agent.AcceptEdits {
		t.Error("full auto without confirming")
	}
	click("确定全部自动")
	if level() != agent.FullAuto || !tt.HasText("全部自动：这个会话里 Agent 的所有操作都不再询问") {
		t.Fatalf("level = %q; %q", level(), tt.Texts())
	}
	click("改回每次询问")
	if level() != agent.AskAlways || tt.HasText("全部自动：这个会话里") {
		t.Errorf("after changing back: %q", level())
	}

	// The background session asks: a badge and a notification.
	wb.Send(back.ID, "b")
	for wb.Status(back.ID).Approvals == 0 {
		<-changes
	}
	frame()
	if !tt.HasText("待审批 1") {
		t.Errorf("no badge: %q", tt.Texts())
	}
	if len(notes) != 1 || !strings.HasPrefix(notes[0], back.ID+"|「b」需要审批|假 Agent 在等你批准") {
		t.Errorf("notifications = %q", notes)
	}
	// Clicking it opens the session, where the card waits.
	sh.Open(back.ID)
	frame()
	click("本会话内始终允许（go test）")
	for wb.Status(back.ID).Running {
		<-changes
	}
	frame()
	click("审批档位：每次询问")
	click("撤销 命令 go test ./...")
	if x, _ := wb.Session(back.ID); len(x.Rules) != 0 {
		t.Errorf("rules after revoking = %+v", x.Rules)
	}
	// Asking again notifies nobody: the session is on screen now.
	wb.Send(back.ID, "c")
	for wb.Status(back.ID).Approvals == 0 {
		<-changes
	}
	frame()
	if len(notes) != 1 {
		t.Errorf("notified for the session on screen: %q", notes)
	}
}

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

	click("压缩上下文")
	for wb.Status(s.ID).Running || len(wb.Markers(s.ID)) == 0 {
		<-changes
	}
	frame()
	shows("上下文已压缩 · 手动 · 1.0k → 100 tokens")

	click("给 假 Agent 发消息")
	tt.Type("/clear")
	tt.Key(0, ui.KeyEnter)
	frame()
	shows("暂不支持 Agent 自带的斜杠命令")
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
	shows("无法续接原生会话", "原生会话无法续接：No conversation found with session ID: x", "原生会话无法续接，请先在上方选择怎么处理")
	click("暂不处理")
	shows("会话只读：原生会话无法续接")
	if tt.HasText("暂不处理") {
		t.Error("read-only still offers to leave it")
	}
	click("新开原生会话并引用之前的内容（推荐）")
	if tt.HasText("原生会话无法续接") {
		t.Errorf("the banner stayed: %q", tt.Texts())
	}
	shows("已切换到新的 Agent 原生会话", "本会话 · #1–#2（2 条）", "给 假 Agent 发消息")
}

// The settings: the default approval level, notifications, the advanced
// budgets, and moving the data directory.
func TestSettingsModal(t *testing.T) {
	block := make(chan struct{})
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Text == "busy" {
			select {
			case <-block:
			case <-ctx.Done():
			}
		}
	}
	dataDir := t.TempDir()
	wb, err := workbench.Open(workbench.Options{DataDir: dataDir, Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	chosen := ""
	var moved []string
	sh := shell.New(wb, shell.Options{
		DataDir:      dataDir,
		ChooseFolder: func() (string, bool) { return chosen, true },
		MoveDataDir:  func(to string) error { moved = append(moved, to); return nil },
	})
	tt := ui.NewTester(sh.View, 1100, 900)
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

	click("设置（⌘,）")
	shows("数据目录", dataDir, "新会话的默认审批档位", "有待审批时发系统通知")
	click("自动接受工作区内修改")
	if got := wb.Settings().DefaultLevel; got != agent.AcceptEdits {
		t.Errorf("default level = %q", got)
	}
	click("有待审批时发系统通知（开关）")
	if wb.Settings().Notify {
		t.Error("notifications still on")
	}

	// A folder in a sync service warns; one with aibo's data is used as is.
	syncDir := filepath.Join(t.TempDir(), "Library", "Mobile Documents", "aibo")
	os.MkdirAll(syncDir, 0o755)
	chosen = syncDir
	click("更改…")
	for i := 0; i < 50 && !tt.HasText("改到："+syncDir); i++ {
		time.Sleep(10 * time.Millisecond) // the folder is chosen off the main thread
		frame()
	}
	shows("改到："+syncDir, "这个文件夹在 iCloud Drive 里", "aibo 会把数据复制过去")
	click("取消")
	withData := t.TempDir()
	os.WriteFile(filepath.Join(withData, "aibo.db"), nil, 0o644)
	chosen = withData
	click("更改…")
	for i := 0; i < 50 && !tt.HasText("改到："+withData); i++ {
		time.Sleep(10 * time.Millisecond)
		frame()
	}
	shows("这个文件夹里已经有 aibo 的数据")
	click("确定更改")
	for i := 0; i < 50 && len(moved) == 0; i++ {
		time.Sleep(10 * time.Millisecond)
		frame()
	}
	if len(moved) != 1 || moved[0] != withData {
		t.Errorf("moved = %v", moved)
	}

	click("高级")
	set := func(field, value string) {
		t.Helper()
		if err := tt.Click(field + "（数值）"); err != nil {
			t.Fatal(err)
		}
		tt.Key(ui.Super, ui.KeyA)
		tt.Type(value)
	}
	set("read_reference 每页", "10") // too small
	click("保存")
	shows("设置的值不在允许的范围内")
	set("read_reference 每页", "12000")
	set("闲置自动断开", "45")
	click("保存")
	if st := wb.Settings(); st.Budgets.Page != 12000 || st.IdleTimeout != 45*time.Minute {
		t.Errorf("settings = %+v", st)
	}
	if tt.HasText("设置的值不在允许的范围内") {
		t.Error("the error stayed")
	}

	// While a session runs, the data stays where it is.
	click("关闭设置")
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "busy")
	tt.Key(ui.Super, ui.KeyComma)
	frame()
	click("通用")
	click("更改…")
	shows("有会话正在运行。请先等它完成或停止，再更改数据目录。")
	close(block)
}

// stub writes an executable shell script standing in for an Agent.
func stub(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

// The Agents as found: the settings' Agent page, unavailable ones grayed
// in the new-session picker, and a session's Agent signed out.
func TestAgentsFoundAndSignedOut(t *testing.T) {
	bin := t.TempDir()
	claudePath := stub(t, bin, "claude", `case "$1" in
--version) echo "2.1.318 (Claude Code)";;
auth) echo '{"loggedIn":false,"authMethod":"none"}'; exit 1;;
esac
`)
	stub(t, bin, "codex", `case "$1" in
--version) echo "codex-cli 0.168.0";;
esac
`)
	sh := stub(t, t.TempDir(), "fakesh", `printf '__AIBO_PATH__/usr/bin__AIBO_PATH__'`)
	reg := agents.New(agents.Options{Shell: sh, Dirs: []string{bin}})
	reg.Detect(context.Background())

	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: reg.Agents(), Ready: reg.Ready})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	var opened []string
	s := shell.New(wb, shell.Options{Agents: reg, OpenTerminal: func(p string) { opened = append(opened, p) }})
	tt := ui.NewTester(s.View, 1100, 900)
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

	// Codex is too old: grayed in the picker, with why.
	click("在 " + filepath.Base(ws.Path) + " 新建会话")
	shows("版本 0.168.0 过低，请升级到 0.169.0 或更高版本。")
	if err := tt.Click("用 Codex 新建会话"); err == nil {
		t.Error("an unavailable Agent can start a session")
	}
	click("用 Claude Code 新建会话")
	for i := 0; i < 50 && !tt.HasText("使用模型 默认"); i++ {
		time.Sleep(10 * time.Millisecond)
		frame()
	}
	click("使用模型 默认")

	// Claude Code is signed out: the session says so, and how to sign in.
	shows("Claude Code 未登录。")
	click("在终端中打开 claude")
	if real, _ := filepath.EvalSymlinks(claudePath); len(opened) != 1 || opened[0] != real {
		t.Errorf("opened %v", opened)
	}
	click("去登录")
	shows("Agent", "未登录", "版本过低", "请在终端里运行 claude 完成登录", "版本 2.1.318")
	click("复制命令")
	if real, _ := filepath.EvalSymlinks(claudePath); tt.Clipboard() != real {
		t.Errorf("clipboard = %q", tt.Clipboard())
	}
}

// withModels is a fake Agent that tells its models.
type withModels struct{ *fake.Agent }

func (withModels) Models(context.Context) ([]agent.Model, error) {
	return []agent.Model{{Name: "默认（Sonnet）"}, {ID: "opus", Name: "Opus", Description: "最强"}}, nil
}

// Managing workspaces and sessions from the sidebar.
func TestSidebarManagement(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "回复：" + turn.Text})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{withModels{fake.New(respond)}}})
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
	root := t.TempDir()
	proj := filepath.Join(root, "shop-api")
	os.Mkdir(proj, 0o755)
	ws, _ := wb.AddWorkspace(proj)
	a, _ := wb.NewSession(ws.ID, fake.Kind, "")
	b, _ := wb.NewSession(ws.ID, fake.Kind, "")
	for id, text := range map[string]string{a.ID: "迁移方案 timestamptz", b.ID: "白屏排查"} {
		wb.Send(id, text)
		for wb.Status(id).Running {
			<-changes
		}
	}
	wb.ReferenceSession(a.ID, b.ID)
	wb.Send(b.ID, "看引用")
	for wb.Status(b.ID).Running {
		<-changes
	}
	var chosen string
	sh := shell.New(wb, shell.Options{ChooseFolder: func() (string, bool) { return chosen, true }})
	tt := ui.NewTester(sh.View, 1100, 900)
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
	menu := func(row, item string) {
		t.Helper()
		if err := tt.RightClick(row); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		if err := tt.ChooseMenuItem(item); err != nil {
			t.Fatalf("%v; the menu is %q", err, tt.Menu())
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
	shows("引用 1") // b received one

	menu("迁移方案 timestamptz", "重命名…")
	tt.Key(ui.Super, ui.KeyA)
	tt.Type("迁移方案（定稿）")
	click("确定")
	if x, _ := wb.Session(a.ID); x.Title != "迁移方案（定稿）" {
		t.Errorf("title = %q", x.Title)
	}

	menu("迁移方案（定稿）", "归档")
	if x, _ := wb.Session(a.ID); !x.Archived {
		t.Error("not archived")
	}
	shows("已归档 · 1")
	click("已归档 · 1")
	shows("迁移方案（定稿）")

	// Search finds it, archived, by its words.
	click("搜索会话")
	tt.Type("timestamptz")
	frame()
	shows("迁移方案 timestamptz") // the snippet
	tt.Key(ui.Super, ui.KeyA)
	tt.Key(0, ui.KeyBackspace)
	frame()

	// Deleting a session referenced says what it breaks.
	menu("迁移方案（定稿）", "删除…")
	shows("删除「迁移方案（定稿）」？", "该会话被 1 个引用使用，删除后这些引用将失效。")
	click("确定删除")
	if _, ok := wb.Session(a.ID); ok {
		t.Error("not deleted")
	}

	// A folder dropped on the window is a workspace.
	dropped := t.TempDir()
	tt.DropFiles(600, 400, dropped)
	frame()
	if got := wb.Workspaces(); len(got) != 2 {
		t.Errorf("workspaces after dropping = %+v", got)
	}

	// A new session, with a model of the Agent's.
	click("在 " + filepath.Base(dropped) + " 新建会话")
	for i := 0; i < 50 && !tt.HasText("使用模型 Opus"); i++ {
		time.Sleep(10 * time.Millisecond)
		frame()
	}
	shows("默认（Sonnet）", "最强")
	click("使用模型 Opus")
	var made model.Session
	for _, x := range wb.Sessions() {
		if x.WorkspaceID != ws.ID {
			made = x
		}
	}
	if made.Model != "opus" {
		t.Errorf("new session = %+v", made)
	}

	// The folder moved away: the session says so, and can be pointed at
	// where it went.
	os.Rename(proj, filepath.Join(root, "moved"))
	wb.CheckWorkspaces()
	click("白屏排查")
	shows("目录不存在", "工作区目录不存在："+proj)
	chosen = filepath.Join(root, "moved")
	click("重新定位…")
	for i := 0; i < 50; i++ {
		if w, _ := wb.Workspace(ws.ID); !w.Missing {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	frame()
	if tt.HasText("工作区目录不存在") {
		t.Error("the banner stayed after relocating")
	}

	// Removing the workspace archives its sessions.
	menu("moved", "移除工作区（会话转为归档）")
	if x, _ := wb.Session(b.ID); !x.Archived {
		t.Error("its session was not archived")
	}
}
