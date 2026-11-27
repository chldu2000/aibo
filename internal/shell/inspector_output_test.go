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

// A big output opened in the details takes the rest of the panel, down to
// its bottom, under a subagent's long prompt too: what is above it
// scrolls on its own.
func TestInspectorOutputFits(t *testing.T) {
	var lines, prompt []string
	for i := 1; i <= 400; i++ {
		lines = append(lines, fmt.Sprintf("output line %d", i))
	}
	for i := 1; i <= 40; i++ {
		prompt = append(prompt, fmt.Sprintf("prompt line %d", i))
	}
	long := strings.Join(lines, "\n")
	task := fmt.Sprintf(`{"description":"count","prompt":%q}`, strings.Join(prompt, "\n"))
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "b", Name: "Bash", Input: []byte(`{"command":"seq 400"}`)})
		emit(agent.ToolFinished{ToolID: "b", Output: long})
		emit(agent.ToolStarted{ToolID: "a", Name: "Agent", Input: []byte(task)})
		emit(agent.ToolFinished{ToolID: "a", Output: long})
		emit(agent.ReplyDelta{ReplyID: "r", Text: "done"})
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
	wb.Send(s.ID, "go")
	for wb.Status(s.ID).Running {
		<-changes
	}
	const height = 800
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, height)
	frame(tt)
	msgs, _ := wb.Messages(s.ID)
	cmd := workbench.Activities(msgs, workbench.Commands)[0]
	sub := workbench.Activities(msgs, workbench.Delegations)[0]

	// output is the visible box of the output's editor in the details.
	output := func() ui.Rect {
		t.Helper()
		var found ui.Rect
		for _, a := range tt.AccessAll() {
			if strings.HasPrefix(a.Value, "output line 1\n") && a.Bounds.X > 600 {
				found = a.Bounds
			}
		}
		return found
	}
	// The panel's content ends 16 above the window's bottom, inside 12 of
	// padding.
	const bottom = height - 16 - 12
	fits := func(what string) {
		t.Helper()
		r := output()
		if r.H < 320 {
			t.Errorf("%s: the output shows %v tall: %+v", what, r.H, r)
		}
		if d := bottom - (r.Y + r.H); d < 0 || d > 4 {
			t.Errorf("%s: the output ends at %v, the panel at %v", what, r.Y+r.H, float32(bottom))
		}
	}

	click(t, tt, startingWith(tt, "2 个工具调用"))
	click(t, tt, "Bash · seq 400")
	click(t, tt, "在详情面板打开 #"+cmd.ID)
	fits("a command")
	click(t, tt, "Bash · seq 400")

	click(t, tt, "Agent · count")
	click(t, tt, "在详情面板打开 #"+sub.ID)
	fits("a subagent")
	if !tt.HasText("prompt line 1") {
		t.Errorf("the prompt does not show: %q", tt.Texts())
	}
}
