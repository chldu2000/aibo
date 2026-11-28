package shell_test

import (
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// A new session says who works and where, with which model and mode, and
// offers to start: the @ panel, or one of the Agent's commands, as the
// composer would.
func TestEmptySession(t *testing.T) {
	f := fake.New(nil)
	f.SetCommands([]agent.Command{
		{Name: "review", Description: "Review the diff", Builtin: true},
		{Name: "init", Description: "Write AGENTS.md", Builtin: true},
		{Name: "greet", Description: "Say hello"},
		{Name: "fourth", Description: "Not offered"},
	}, false)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	dir := t.TempDir()
	ws, _ := wb.AddWorkspace(dir)
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	// The commands known, as after the user once opened the "/" panel: a new
	// session asks for none.
	for l := wb.CommandList(s.ID, workbench.ModelSource{}, workbench.LoadCommands); len(l.Commands) == 0; l = wb.CommandList(s.ID, workbench.ModelSource{}, workbench.PeekCommands) {
		time.Sleep(5 * time.Millisecond)
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, 800)
	// The commands come off the main thread.
	for range 40 {
		frame(tt)
		if _, ok := tt.Find("以 /init 开始"); ok {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	for _, want := range []string{"假 Agent", dir, "默认模型 · Ask", "发一条消息开始对话", "@ 提及文件或会话", "/review", "/init", "/greet"} {
		if !tt.HasText(want) {
			t.Errorf("the new session lacks %q: %q", want, tt.Texts())
		}
	}
	if tt.HasText("/fourth") {
		t.Error("more than three commands offered")
	}

	click(t, tt, "以 /init 开始")
	// The chip in the draft, which its button removes.
	if _, ok := tt.Find("移除命令 /init"); !ok {
		t.Errorf("no command chip: %q", tt.Texts())
	}
	if v, _ := wb.Messages(s.ID); len(v) != 0 {
		t.Errorf("choosing a command sent %v", v)
	}

	click(t, tt, "@ 提及文件或会话")
	if !tt.HasText("文件") || !tt.HasText("会话") {
		t.Errorf("the @ panel did not open: %q", tt.Texts())
	}
}
