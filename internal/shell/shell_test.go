package shell_test

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
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
