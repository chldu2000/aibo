package shell_test

import (
	"context"
	"path/filepath"
	"regexp"
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
