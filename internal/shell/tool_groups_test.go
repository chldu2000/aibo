package shell_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// startingWith is the first text or label shown that starts with prefix,
// as a group's controls, whose labels end with the group's range.
func startingWith(tt *ui.Tester, prefix string) string {
	for _, s := range tt.Texts() {
		if strings.HasPrefix(s, prefix) {
			return s
		}
	}
	return prefix
}

// The calls between two replies fold into a line that counts what they
// did; open, a symbol for each opens its call, or all are listed. A failed
// call stays out; choosing messages, or a highlight, shows them all.
func TestToolGroups(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		n := 0
		call := func(name, input string, failed bool) {
			n++
			id := fmt.Sprint("t", n)
			emit(agent.ToolStarted{ToolID: id, Name: name, Input: json.RawMessage(input)})
			emit(agent.ToolFinished{ToolID: id, Output: "out " + id, IsError: failed})
		}
		emit(agent.ReplyDone{ReplyID: "a", Text: "looking"})
		for _, p := range []string{"a.txt", "b.txt", "c.txt"} {
			call("Read", `{"file_path":"`+p+`"}`, false)
		}
		call("Grep", `{"pattern":"needle"}`, false)
		call("Bash", `{"command":"false"}`, true)
		call("Read", `{"file_path":"d.txt"}`, false)
		if turn.Text == "wait" {
			<-ctx.Done()
			return
		}
		emit(agent.ReplyDone{ReplyID: "b", Text: "done looking"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(x.ID, "go")
	for wb.Status(x.ID).Running {
		<-changes
	}
	sh := shell.New(wb, shell.Options{Only: x.ID})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1100, 900)
	frame(tt)
	shown := func(want bool, texts ...string) {
		t.Helper()
		for _, s := range texts {
			if exactly(tt, s) != want {
				t.Errorf("%q shown = %v, want %v: %q", s, !want, want, tt.Texts())
			}
		}
	}

	// A symbol for each, the count after, and the failed call on its own.
	if !tt.HasText("5 个工具调用 · 读了 4 个文件 · 搜索 1 次") {
		t.Errorf("no count: %q", tt.Texts())
	}
	shown(true, "Bash · false · 出错")
	shown(false, "Read · a.txt", "Read · b.txt")

	// A symbol opens its call alone.
	if _, ok := tt.Find(startingWith(tt, "Read · b.txt #")); !ok {
		t.Fatalf("no symbol for b.txt: %q", tt.Texts())
	}
	click(t, tt, startingWith(tt, "Read · b.txt #"))
	shown(true, "Read · b.txt")
	shown(false, "Read · c.txt")
	click(t, tt, startingWith(tt, "Read · b.txt #"))
	shown(false, "Read · b.txt")

	// Listed, all show; hidden again, none.
	click(t, tt, startingWith(tt, "5 个工具调用"))
	shown(true, "Read · a.txt", "Read · b.txt", "Read · c.txt", "Grep · needle", "Read · d.txt")
	click(t, tt, startingWith(tt, "5 个工具调用"))
	shown(false, "Read · a.txt", "Read · d.txt")

	// Choosing messages, each call is a message of its own.
	click(t, tt, "选择消息以引用或复制")
	shown(true, "Read · a.txt", "Read · d.txt")
	if tt.HasText("5 个工具调用") {
		t.Errorf("grouped: %q", tt.Texts())
	}
	click(t, tt, "取消")
	if !tt.HasText("5 个工具调用") {
		t.Errorf("not grouped again: %q", tt.Texts())
	}

	// A highlight among them shows them too.
	msgs, _ := wb.Messages(x.ID)
	sh.Reveal(x.ID, msgs[2].Seq, msgs[2].Seq)
	frame(tt)
	shown(true, "Read · a.txt")
	if tt.HasText("5 个工具调用") {
		t.Errorf("grouped: %q", tt.Texts())
	}
}

// While the turn goes on with its calls, the line says so.
func TestToolGroupLive(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		for i, p := range []string{"a.txt", "b.txt"} {
			id := fmt.Sprint("t", i)
			emit(agent.ToolStarted{ToolID: id, Name: "Read", Input: json.RawMessage(`{"file_path":"` + p + `"}`)})
			emit(agent.ToolFinished{ToolID: id, Output: "x"})
		}
		<-ctx.Done()
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	sh := shell.New(wb, shell.Options{Only: x.ID})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1100, 900)
	wb.Send(x.ID, "go")
	waitText(t, tt, "正在调用工具 · 已完成 2 个")
	wb.Stop(x.ID)
	waitText(t, tt, "2 个工具调用")
}

// exactly tells whether text shows as it is, not inside a longer one.
func exactly(tt *ui.Tester, text string) bool {
	for _, s := range tt.Texts() {
		if s == text {
			return true
		}
	}
	return false
}

// Past 24, the symbols count the others as one, which lists them all.
func TestToolGroupMany(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "a", Text: "reading"})
		for i := range 30 {
			id := fmt.Sprint("t", i)
			emit(agent.ToolStarted{ToolID: id, Name: "Read", Input: json.RawMessage(fmt.Sprintf(`{"file_path":"f%02d.txt"}`, i))})
			emit(agent.ToolFinished{ToolID: id, Output: "x"})
		}
		emit(agent.ReplyDone{ReplyID: "b", Text: "read"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(x.ID, "go")
	for wb.Status(x.ID).Running {
		<-changes
	}
	sh := shell.New(wb, shell.Options{Only: x.ID})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1100, 900)
	frame(tt)
	if !tt.HasText("Read · f23.txt #") || tt.HasText("Read · f24.txt #") || !tt.HasText("逐条列出 工具调用") {
		t.Fatalf("not 24 symbols and +6: %q", tt.Texts())
	}
	if !tt.HasText("30 个工具调用 · 读了 30 个文件") {
		t.Errorf("no count: %q", tt.Texts())
	}
	click(t, tt, startingWith(tt, "逐条列出"))
	if !exactly(tt, "Read · f29.txt") {
		t.Errorf("+6 did not list them: %q", tt.Texts())
	}
}
