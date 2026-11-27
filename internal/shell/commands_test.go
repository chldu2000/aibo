package shell_test

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// "/" at the start of the draft lists the Agent's commands, which the
// letters after it filter; the arrows and Enter choose one, which goes
// into the draft as a chip; sent, the Agent gets the command and the
// words after it. Typed with a space after it, a command's name, or an
// alias, becomes the chip too, and Backspace puts it back as words. A
// "/word" that is none is not sent.
func TestCommandPanel(t *testing.T) {
	var mu sync.Mutex
	var got []agent.Turn
	f := fake.New(func(_ context.Context, _ agent.StartOptions, turn agent.Turn, _ func(agent.Event)) {
		mu.Lock()
		got = append(got, turn)
		mu.Unlock()
	})
	f.SetCommands([]agent.Command{
		{Name: "review", Aliases: []string{"code-review"}, Description: "Review the diff", ArgumentHint: "[path]", Builtin: true},
		{Name: "init", Description: "Write AGENTS.md", Builtin: true},
		{Name: "greet", Description: "Say hello", Source: "repo"},
	}, false)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
			time.Sleep(5 * time.Millisecond) // the commands come off the main thread
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
	until := func(s string) {
		t.Helper()
		for i := 0; i < 100 && !tt.HasText(s); i++ {
			frame()
		}
		if !tt.HasText(s) {
			t.Fatalf("never %q: %q", s, tt.Texts())
		}
	}
	shows := func(s string) bool { _, ok := tt.Find(s); return ok }
	sent := func(n int) []agent.Turn {
		t.Helper()
		for i := 0; i < 200; i++ {
			mu.Lock()
			out := slices.Clone(got)
			mu.Unlock()
			if len(out) >= n {
				return out
			}
			frame()
		}
		t.Fatalf("the Agent got %d turns", len(got))
		return nil
	}

	click("给 假 Agent 发消息")
	tt.Type("/")
	until("使用 /review")
	if !tt.HasText("假 Agent 的命令") || !tt.HasText("[path]") || !tt.HasText("Review the diff") || !tt.HasText("repo") {
		t.Errorf("the panel shows %q", tt.Texts())
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "11-panel.png"))
	}
	tt.Type("re")
	frame()
	texts := tt.Texts()
	review, greet := slices.Index(texts, "使用 /review"), slices.Index(texts, "使用 /greet")
	if review < 0 || greet < review || shows("使用 /init") {
		t.Fatalf("filtered by \"re\": %q", texts)
	}
	// The second match: greet, which has "re" only inside it.
	tt.Key(0, ui.KeyDown)
	frame()
	tt.Key(0, ui.KeyEnter)
	frame()
	if !shows("移除命令 /greet") || shows("使用 /review") {
		t.Fatalf("no chip, or the panel stayed: %q", tt.Texts())
	}
	tt.Type("Bob")
	frame()
	tt.Key(0, ui.KeyEnter)
	frame()
	if turns := sent(1); turns[0].Command == nil || turns[0].Command.Name != "greet" || turns[0].Text != "Bob" {
		t.Errorf("the Agent got %+v", turns[0])
	}
	if shows("移除命令 /greet") {
		t.Error("the chip stayed after sending")
	}
	ms, _ := wb.Messages(x.ID)
	if len(ms) == 0 || ms[0].Command == nil || ms[0].Command.Name != "greet" {
		t.Errorf("messages = %+v", ms)
	}

	// Typed, by an alias.
	tt.Type("/code-review src/")
	frame()
	if !shows("移除命令 /review") {
		t.Fatalf("no chip for a typed alias: %q", tt.Texts())
	}
	for range len("src/") {
		tt.Key(0, ui.KeyBackspace)
		frame()
	}
	tt.Key(0, ui.KeyBackspace)
	frame()
	if shows("移除命令 /review") || shows("使用 /review") {
		t.Fatalf("Backspace left the chip, or opened the panel: %q", tt.Texts())
	}

	// A word no command answers: the panel says so, Escape closes it,
	// and it is not sent.
	for range len("/review") {
		tt.Key(0, ui.KeyBackspace)
		frame()
	}
	tt.Type("/nope")
	until("没有匹配的命令")
	tt.Key(0, ui.KeyEscape)
	frame()
	if tt.HasText("没有匹配的命令") {
		t.Fatalf("Escape left the panel: %q", tt.Texts())
	}
	tt.Type(" x")
	frame()
	tt.Key(0, ui.KeyEnter)
	frame()
	until("“/nope”不是 假 Agent 的可用命令。想原样发给模型，请在开头加一个空格。")
	if turns := sent(1); len(turns) != 1 {
		t.Errorf("sent: %+v", turns)
	}
}

// The timeline shows a command a message invoked as its chip, what a
// command printed as its output, a command that said nothing, and the
// context the Agent cleared. A command given no choice opens the menu of
// its control.
func TestCommandTimeline(t *testing.T) {
	f := fake.New(func(_ context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Command == nil {
			return
		}
		switch turn.Command.Name {
		case "context":
			emit(agent.ReplyDone{ReplyID: "out", Text: "Context: 12k tokens", CommandOutput: true})
		case "clear":
			emit(agent.ContextReset{})
			emit(agent.NativeSessionStarted{ID: "after-clear"})
		}
	})
	f.SetCommands([]agent.Command{
		{Name: "context", Description: "Show the context", Builtin: true},
		{Name: "init", Description: "Write AGENTS.md", Builtin: true},
		{Name: "clear", Description: "Clear the context", Builtin: true, Handling: agent.ByReset},
		{Name: "permissions", Description: "Choose the mode", Builtin: true, Handling: agent.ByMode},
	}, false)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.CommandList(x.ID, workbench.ModelSource{}, workbench.LoadCommands)
	for wb.CommandList(x.ID, workbench.ModelSource{}, workbench.PeekCommands).Loading {
		time.Sleep(5 * time.Millisecond)
	}
	for _, o := range []workbench.Outgoing{{Command: "context"}, {Command: "init", Text: "for Go"}, {Command: "clear"}} {
		if err := wb.SendMessage(x.ID, o); err != nil {
			t.Fatal(err)
		}
		for wb.Status(x.ID).Running {
			time.Sleep(5 * time.Millisecond)
		}
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
			time.Sleep(5 * time.Millisecond)
		}
	}
	frame()
	for _, want := range []string{"命令 /context", "/context", "命令输出", "Context: 12k tokens", "命令 /init", "for Go", "命令已执行，没有输出", "命令 /clear", "上下文已重置：Agent 换了新的原生会话"} {
		if !tt.HasText(want) {
			if _, ok := tt.Find(want); !ok {
				t.Errorf("the timeline lacks %q: %q", want, tt.Texts())
			}
		}
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "12-timeline.png"))
	}

	// "/permissions" with no mode: its menu opens.
	if err := tt.Click("给 假 Agent 发消息"); err != nil {
		t.Fatal(err)
	}
	frame()
	tt.Type("/permissions ")
	frame()
	tt.Key(0, ui.KeyEnter)
	frame()
	if !tt.HasText("假 Agent 的权限模式") {
		t.Errorf("no mode menu: %q", tt.Texts())
	}
	if _, ok := tt.Find("移除命令 /permissions"); ok {
		t.Error("the chip stayed")
	}
}
