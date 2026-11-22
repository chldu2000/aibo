package shell_test

import (
	"context"
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
	shows("引用文件或会话")
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
	click("引用文件或会话（@）")
	click("选择 问：迁移的风险")
	click("返回搜索")
	shows("选择 问：迁移的风险")
}

// "@" is text after a letter, in a paste, and while the panel it opened
// closes without a choice; at the start or after a space it opens the
// panel, typed or committed by an input method.
func TestTypeLiteralAt(t *testing.T) {
	var got []string
	var mu sync.Mutex
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		mu.Lock()
		got = append(got, turn.Text)
		mu.Unlock()
		emit(agent.ReplyDone{ReplyID: "r"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	wb.NewSession(ws.ID, fake.Kind, "")
	sh := shell.New(wb, shell.Options{})
	tt := ui.NewTester(sh.View, 1100, 800)
	tt.Frame()
	panelOpen := func() bool {
		for _, s := range tt.Texts() {
			if s == "引用文件或会话" { // the @ panel's title
				return true
			}
		}
		return false
	}
	if err := tt.Click("给 假 Agent 发消息"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	step := func(what string, open bool, do func()) {
		t.Helper()
		do()
		tt.Frame()
		if panelOpen() != open {
			t.Fatalf("after %s, the @ panel open = %v; the window shows %q", what, !open, tt.Texts())
		}
	}

	step("a@b", false, func() { tt.Type("a"); tt.Frame(); tt.Type("@"); tt.Frame(); tt.Type("b") })
	step("a space and @", true, func() { tt.Type(" "); tt.Frame(); tt.Type("@") })
	step("Esc", false, func() { tt.Key(0, ui.KeyEscape) })
	step("typing on", false, func() { tt.Type("x ") })
	step("a paste ending in @", false, func() { tt.SetClipboard("c @"); tt.Command("paste") })
	step("composing @", false, func() { tt.Type(" "); tt.Frame(); tt.Compose("＠", 1) })
	step("committing @", true, func() { tt.Type("@") })
	step("Esc", false, func() { tt.Key(0, ui.KeyEscape) })

	tt.Key(0, ui.KeyEnter)
	for i := 0; i < 100; i++ {
		tt.Frame()
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if want := "a@b @x c @ @"; len(got) != 1 || got[0] != want {
		t.Errorf("the Agent received %q; want %q", got, want)
	}
}
