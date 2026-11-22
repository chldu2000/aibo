package shell_test

import (
	"context"
	"fmt"
	"image"
	"image/png"
	"os"
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
	mode := func() string { x, _ := wb.Session(front.ID); return x.Mode }

	// The fake's own modes, under its own names.
	click("权限模式：Ask")
	click("Edits")
	if mode() != fake.ModeEdits {
		t.Fatalf("mode = %q", mode())
	}
	click("权限模式：Edits")
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "11-menu.png"))
	}
	click("Auto")
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "11-confirm.png"))
	}
	if mode() != fake.ModeEdits {
		t.Error("a dangerous mode without confirming")
	}
	click("确定切换到 Auto")
	if mode() != fake.ModeAuto {
		t.Fatalf("mode = %q", mode())
	}
	// No banner: the mode button and the sidebar's row warn instead.
	if tt.HasText("这个会话里 Agent 的所有操作都不再询问") || tt.HasText("改回每次询问") {
		t.Errorf("a banner for a dangerous mode: %q", tt.Texts())
	}
	for _, l := range []string{"权限模式：Auto", "Auto · 新会话"} {
		if _, ok := tt.Find(l); !ok {
			t.Errorf("no %q: %q", l, tt.Texts())
		}
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "11-danger-light.png"))
		tt.SetDark(true)
		frame()
		saveImage(t, tt.Image(), filepath.Join(p, "11-danger-dark.png"))
		tt.SetDark(false)
		frame()
	}
	click("权限模式：Auto")
	click("Ask")
	if mode() != fake.ModeAsk {
		t.Errorf("after changing back: %q", mode())
	}
	if _, ok := tt.Find("Auto · 新会话"); ok {
		t.Error("the sidebar still warns")
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
	click("权限模式：Ask")
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

// However long the command, the card stays in the session area with every
// button in sight: the buttons say what they do, and the rules they allow
// show apart from them, in full.
func TestLongCommandApprovalCard(t *testing.T) {
	cmd := strings.Repeat("x", 10000)
	opts := []agent.ApprovalOption{
		{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"},
		{ID: "session", Kind: agent.AllowSession, Label: "本会话内始终允许", Detail: []string{"Bash(" + cmd + ")"},
			Rules: []agent.Rule{{Label: "Bash(" + cmd + ")"}}},
		{ID: "always", Kind: agent.AllowAlways, Label: "永久允许", Detail: []string{"以 " + cmd + " 开头的命令"}, Where: "Codex 的执行策略规则"},
		{ID: "no", Kind: agent.Deny, Label: "拒绝"},
		{ID: "stop", Kind: agent.DenyStop, Label: "拒绝并停止"},
	}
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "1", Name: "Bash", Input: []byte(`{"command":"` + cmd + `"}`)})
		emit(agent.ApprovalRequested{ID: "ap", ToolID: "1", Title: "执行命令", Command: cmd, Cwd: "/" + cmd, Options: opts})
		select {
		case <-f.Decisions():
			emit(agent.ToolFinished{ToolID: "1", Output: "ok"})
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
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "跑")
	for wb.Status(s.ID).Approvals == 0 {
		<-changes
	}
	const w, h = 1100, 800
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, w, h)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	frame()
	inSight := func(labels ...string) {
		t.Helper()
		for _, l := range labels {
			r, ok := tt.Find(l)
			if !ok {
				t.Errorf("no %q in the window", l)
				continue
			}
			if r.X < 0 || r.Y < 0 || r.X+r.W > w || r.Y+r.H > h {
				t.Errorf("%q at %+v, outside the %dx%d window", l, r, w, h)
			}
		}
	}
	inSight("审批卡片：执行命令", "需要审批 · 执行命令", "批准本次", "本会话内始终允许", "永久允许…", "拒绝…", "拒绝并停止", "查看将允许的规则")
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "10-long-command.png"))
	}

	// The rules show in full, the card still in the window.
	if err := tt.Click("查看将允许的规则"); err != nil {
		t.Fatal(err)
	}
	frame()
	inSight("审批卡片：执行命令", "批准本次", "拒绝并停止", "本会话内始终允许：", "永久允许：")
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "10-long-command-rules.png"))
	}

	// The permanent rule's confirmation names it.
	if err := tt.Click("永久允许…"); err != nil {
		t.Fatal(err)
	}
	frame()
	inSight("确定永久允许", "取消")
	if !tt.HasText("以 xxxx") {
		t.Errorf("the confirmation does not name the rule: %q", tt.Texts())
	}

	// Allowed for the session, the rule shows in one line in the lists,
	// its revoke button in sight.
	for _, l := range []string{"取消", "本会话内始终允许"} {
		if err := tt.Click(l); err != nil {
			t.Fatal(err)
		}
		frame()
	}
	for len(wb.Sessions()[0].Rules) == 0 {
		<-changes
	}
	frame()
	revoke := "撤销 " + string([]rune("Bash(" + cmd + ")")[:200]) + "…"
	for _, open := range []string{"会话详情", "权限模式：Ask"} {
		if err := tt.Click(open); err != nil {
			t.Fatal(err)
		}
		frame()
		inSight(revoke)
		if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
			saveImage(t, tt.Image(), filepath.Join(p, "10-rules-"+open+".png"))
		}
		tt.Key(0, ui.KeyEscape)
		if err := tt.Click(open); err == nil && open == "会话详情" {
			frame() // the details close by their button
		}
		frame()
	}
}

func saveImage(t *testing.T, img image.Image, path string) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}

// A plan to approve shows as Markdown, not as the tool's JSON input.
func TestPlanApprovalCard(t *testing.T) {
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "p", Name: "ExitPlanMode", Input: []byte(`{"plan":"# Plan\n\n1. Create a.txt"}`)})
		emit(agent.ApprovalRequested{ID: "ap", ToolID: "p", Title: "按计划开始执行", Plan: "# Plan\n\n1. Create a.txt",
			Input: []byte(`{"plan":"# Plan\n\n1. Create a.txt"}`), Options: []agent.ApprovalOption{{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"}}})
		select {
		case <-f.Decisions():
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
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "plan")
	for wb.Status(s.ID).Approvals == 0 {
		<-changes
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	for i := 0; i < 3; i++ {
		tt.Frame()
		tt.Advance(time.Second)
	}
	if !tt.HasText("需要审批 · 按计划开始执行") || !tt.HasText("Create a.txt") || tt.HasText(`"plan"`) {
		t.Errorf("the window shows %q", tt.Texts())
	}
}
