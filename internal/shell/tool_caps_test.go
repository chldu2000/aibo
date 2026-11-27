package shell_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// An open call stays short: its arguments fold under their gist, a long
// output scrolls in a box, in a subagent's steps too; a command opens in
// the details.
func TestToolCallCaps(t *testing.T) {
	var lines []string
	for i := 1; i <= 100; i++ {
		lines = append(lines, fmt.Sprintf("line %d", i))
	}
	long := strings.Join(lines, "\n")
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "b", Name: "Bash", Input: []byte(`{"command":"seq 100","description":"count"}`)})
		emit(agent.ToolFinished{ToolID: "b", Output: long})
		emit(agent.ToolStarted{ToolID: "a", Name: "Agent", Input: []byte(`{"description":"count again"}`)})
		emit(agent.ToolStarted{ToolID: "c", Parent: "a", Name: "Bash", Input: []byte(`{"command":"seq 100 again"}`)})
		emit(agent.ToolFinished{ToolID: "c", Parent: "a", Output: long})
		emit(agent.ToolFinished{ToolID: "a", Output: "done"})
		emit(agent.ReplyDelta{ReplyID: "r", Text: "after the calls"})
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
	wb.Send(s.ID, "count")
	for wb.Status(s.ID).Running {
		<-changes
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, 1000)
	frame(tt)
	// How far a call's line stands from the reply below it.
	span := func(label string) float32 {
		t.Helper()
		top, ok := tt.Find(label)
		if !ok {
			t.Fatalf("no %q: %q", label, tt.Texts())
		}
		end, ok := tt.Find("after the calls")
		if !ok {
			t.Fatalf("no reply: %q", tt.Texts())
		}
		return end.Y - top.Y
	}
	const call, delegation, child = "Bash · seq 100", "Agent · count again · 子代理 1 步", "Bash · seq 100 again"

	click(t, tt, call)
	if !tt.HasText("line 1") || !tt.HasText("显示参数") {
		t.Fatalf("the call did not open: %q", tt.Texts())
	}
	if tt.HasText(`"description": "count"`) {
		t.Error("the arguments show unfolded")
	}
	// Folded, the next call and the reply: the output box takes 240 and
	// what is around it about 200.
	if d := span(call); d > 480 {
		t.Errorf("the open call is %v tall", d)
	}
	click(t, tt, "显示参数")
	if !tt.HasText(`"description": "count"`) {
		t.Errorf("the arguments do not show: %q", tt.Texts())
	}
	click(t, tt, "显示参数")
	click(t, tt, call)

	click(t, tt, delegation)
	click(t, tt, child)
	if d := span(delegation); d > 640 {
		t.Errorf("the subagent's open step is %v tall", d)
	}
	click(t, tt, child)
	click(t, tt, delegation)

	// A command opens on its own page of the details.
	msgs, _ := wb.Messages(s.ID)
	cmds := workbench.Activities(msgs, workbench.Commands)
	first := cmds[len(cmds)-1] // newest first
	click(t, tt, call)
	click(t, tt, "在详情面板打开 #"+first.ID)
	if !tt.HasText("未记录工作目录") || tt.HasText("#"+first.ID+" · ") {
		t.Fatalf("the details did not open on #%s: %q", first.ID, tt.Texts())
	}

	// The subagent's step opens as its own call.
	click(t, tt, "关闭会话详情")
	click(t, tt, call)
	click(t, tt, delegation)
	click(t, tt, child)
	click(t, tt, "在详情面板打开 #"+cmds[0].ID)
	if !tt.HasText("#"+cmds[0].ID) || !strings.Contains(cmds[0].ID, ".") {
		t.Fatalf("the details did not open on #%s: %q", cmds[0].ID, tt.Texts())
	}
}
