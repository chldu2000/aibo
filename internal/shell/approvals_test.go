package shell_test

import (
	"context"
	"fmt"
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
