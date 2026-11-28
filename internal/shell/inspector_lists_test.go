package shell_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// A long command history: the call running on top, the others newest
// first, a hundred of them and a line for the rest; narrowed by words, or
// to the failed.
func TestLongCommandList(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		for i := range 150 {
			id := fmt.Sprint("t", i)
			emit(agent.ToolStarted{ToolID: id, Name: "Bash", Input: json.RawMessage(fmt.Sprintf(`{"command":"echo %d"}`, i))})
			code := i % 2 // the odd ones fail
			emit(agent.ToolFinished{ToolID: id, Output: fmt.Sprint(i), ExitCode: &code})
		}
		emit(agent.ToolStarted{ToolID: "live", Name: "Bash", Input: json.RawMessage(`{"command":"sleep forever"}`)})
		<-ctx.Done()
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 4096)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "go")
	for {
		ms, _ := wb.Messages(s.ID)
		if len(ms) == 152 {
			break
		}
		<-changes
	}
	defer wb.Stop(s.ID)
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1300, 900)
	frame(tt)
	click(t, tt, "会话详情")
	click(t, tt, "命令记录")
	frame(tt)

	shows := func(text string, want bool) {
		t.Helper()
		// Exactly: the conversation's calls are labelled "Bash · echo 0 #2".
		if _, ok := tt.Find(text); ok != want {
			t.Errorf("%q shown = %v, want %v", text, !want, want)
		}
	}
	top, _ := tt.Find("sleep forever")
	newest, _ := tt.Find("echo 149")
	if top.H == 0 || newest.H == 0 || top.Y >= newest.Y {
		t.Errorf("the call running is at %v, under the newest at %v", top.Y, newest.Y)
	}
	// The running one and 99 more: echo 149 down to echo 51.
	shows("echo 51", true)
	shows("echo 50", false)
	reach(t, tt, "命令记录还有 51 个")
	click(t, tt, "命令记录还有 51 个")
	shows("echo 0", true)
	reach(t, tt, "收起命令记录")
	click(t, tt, "收起命令记录")
	shows("echo 0", false)

	toTop(tt)
	click(t, tt, "只看失败的")
	shows("echo 148", false)
	shows("echo 149", true)
	shows("sleep forever", false)
	click(t, tt, "只看失败的")

	click(t, tt, "按命令或描述过滤")
	tt.Type("echo 42")
	frame(tt)
	shows("echo 42", true)
	shows("echo 142", false)
	shows("echo 149", false)
	tt.Type("x")
	frame(tt)
	if !tt.HasText("没有符合条件的调用") {
		t.Errorf("no word that none match: %q", tt.Texts())
	}
}

// A group of many changes: a hundred, and a line for the rest; its
// heading folds it.
func TestLongGitGroups(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-b", "main").CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	for i := range 120 {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("f%03d.txt", i)), []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(root)
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1300, 900)
	frame(tt)
	click(t, tt, "会话详情")
	click(t, tt, "Git 状态")
	waitText(t, tt, "f000.txt")
	if !tt.HasText("f099.txt") || tt.HasText("f100.txt") {
		t.Errorf("not the first hundred: %q", tt.Texts())
	}
	reach(t, tt, "未跟踪还有 20 个")
	click(t, tt, "未跟踪还有 20 个")
	waitText(t, tt, "f119.txt")
	toTop(tt)
	click(t, tt, "未跟踪")
	frame(tt)
	if tt.HasText("f000.txt") {
		t.Errorf("the group did not fold: %q", tt.Texts())
	}
	click(t, tt, "未跟踪")
	waitText(t, tt, "f000.txt")
}

// reach scrolls the details panel until the control labelled label is in
// the panel, which ends 28 above the bottom of the window, 900 tall.
func reach(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	for range 60 {
		r, _ := tt.Find(label)
		var dy float32
		switch {
		case r.Y < 120:
			dy = -300
		case r.Y+r.H > 873:
			dy = 300
		default:
			return
		}
		tt.Scroll(1100, 450, 0, dy)
		tt.Frame()
	}
	r, _ := tt.Find(label)
	t.Fatalf("%q stays at %v", label, r)
}

// toTop scrolls the details panel back to its top.
func toTop(tt *ui.Tester) {
	tt.Scroll(1100, 450, 0, -1e6)
	tt.Frame()
	tt.Frame()
}
