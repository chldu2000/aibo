package shell_test

import (
	"context"
	"strconv"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// Two replies' reasoning and two calls' arguments, all open: each fold
// shows the same words, and is labelled by its message or call.
func TestFoldLabels(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ThinkingDelta{ReplyID: "m", Text: "first thought"})
		emit(agent.ReplyDelta{ReplyID: "m", Text: "first reply"})
		emit(agent.ReplyDone{ReplyID: "m"})
		emit(agent.ToolStarted{ToolID: "a", Name: "Bash", Input: []byte(`{"command":"ls one"}`)})
		emit(agent.ToolFinished{ToolID: "a", Output: "one"})
		emit(agent.ToolStarted{ToolID: "b", Name: "Bash", Input: []byte(`{"command":"ls two"}`)})
		emit(agent.ToolFinished{ToolID: "b", Output: "two"})
		emit(agent.ThinkingDelta{ReplyID: "n", Text: "second thought"})
		emit(agent.ReplyDelta{ReplyID: "n", Text: "second reply"})
		emit(agent.ReplyDone{ReplyID: "n"})
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
	msgs, _ := wb.Messages(s.ID)
	var replies []int
	for _, m := range msgs {
		if m.Thinking != "" {
			replies = append(replies, m.Seq)
		}
	}
	cmds := workbench.Activities(msgs, workbench.Commands)
	if len(replies) != 2 || len(cmds) != 2 {
		t.Fatalf("replies %v, commands %v", replies, cmds)
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, 1000)
	frame(tt)

	click(t, tt, startingWith(tt, "2 个工具调用"))
	click(t, tt, "Bash · ls one")
	click(t, tt, "Bash · ls two")
	labels := []string{
		"思考 #" + strconv.Itoa(replies[0]), "思考 #" + strconv.Itoa(replies[1]),
		"显示参数 #" + cmds[1].ID, "显示参数 #" + cmds[0].ID, // newest first
	}
	for _, l := range labels {
		click(t, tt, l)
	}
	for _, want := range []string{"first thought", "second thought", `"command": "ls one"`, `"command": "ls two"`} {
		if !tt.HasText(want) {
			t.Errorf("%q does not show: %q", want, tt.Texts())
		}
	}
	seen := map[string]bool{}
	for _, a := range tt.AccessAll() {
		if a.Role == ui.RoleButton || a.Role == ui.RoleGroup {
			if a.Name != "" && seen[a.Name] {
				t.Errorf("two controls are labelled %q", a.Name)
			}
			seen[a.Name] = true
		}
	}
}
