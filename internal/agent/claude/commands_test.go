package claude

import (
	"bufio"
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// commandLines are Claude Code 2.1.331's lines of testdata/commands.jsonl
// (.scratch/agent-commands/research/01): initialize's answer, then
// commands_changed, "/context", "/help" and "/clear".
func commandLines(t *testing.T) [][]byte {
	t.Helper()
	f, err := os.Open("testdata/commands.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out [][]byte
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 4<<20)
	for sc.Scan() {
		out = append(out, slices.Clone(sc.Bytes()))
	}
	return out
}

func find(cmds []agent.Command, name string) (agent.Command, bool) {
	i := slices.IndexFunc(cmds, func(c agent.Command) bool { return c.Name == name })
	if i < 0 {
		return agent.Command{}, false
	}
	return cmds[i], true
}

// initialize tells the commands: the built-ins ruled on, how each is
// carried out, and all the others.
func TestInitCommands(t *testing.T) {
	cmds, ok := initCommands(commandLines(t)[0])
	if !ok {
		t.Fatal("not initialize's answer")
	}
	for name, want := range map[string]agent.Handling{
		"init": agent.ByAgent, "context": agent.ByAgent, "model": agent.ByModel, "effort": agent.ByEffort,
		"compact": agent.ByCompact, "rename": agent.ByRename, "clear": agent.ByReset,
	} {
		if c, ok := find(cmds, name); !ok || c.Handling != want || !c.Builtin {
			t.Errorf("%s = %+v, %v", name, c, ok)
		}
	}
	for _, name := range []string{"doctor", "mcp", "config", "loop", "goal", "agents", "fast"} {
		if _, ok := find(cmds, name); ok {
			t.Errorf("%s is offered", name)
		}
	}
	if c, _ := find(cmds, "clear"); !c.Answers("reset") || !c.Answers("new") {
		t.Errorf("clear's aliases = %v", c.Aliases)
	}
	c, ok := find(cmds, "probe-hello")
	if !ok || c.Builtin || c.Handling != agent.ByAgent || c.ArgumentHint != "<name>" || c.Source != "" ||
		c.Description != "Probe command that says hello to an argument (project)" {
		t.Errorf("the project's command = %+v, %v", c, ok)
	}
	if _, ok := find(cmds, "svelte:svelte-code-writer"); !ok {
		t.Error("a plugin's skill is not offered")
	}
}

// Every built-in Claude Code was recorded telling is ruled on.
func TestBuiltinsRuledOn(t *testing.T) {
	var told struct {
		Response struct {
			Response struct {
				Commands []command `json:"commands"`
			} `json:"response"`
		} `json:"response"`
	}
	if err := json.Unmarshal(commandLines(t)[0], &told); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, c := range told.Response.Response.Commands {
		if !c.Builtin {
			continue
		}
		n++
		if _, ok := builtins[c.Name]; !ok && !ruledOut[c.Name] {
			t.Errorf("/%s is not ruled on", c.Name)
		}
	}
	if n != 45 {
		t.Errorf("%d built-ins", n)
	}
}

// Changed commands, what local commands print, and "/clear" as events.
func TestCommandEvents(t *testing.T) {
	lines := commandLines(t)
	p := newParser()
	var evs []agent.Event
	for _, l := range lines[1:] {
		evs = append(evs, p.line(l)...)
	}
	var (
		changed  []agent.Command
		printed  []string
		reset    = -1
		natives  []string
		resetIdx int
	)
	for i, e := range evs {
		switch e := e.(type) {
		case agent.CommandsChanged:
			changed = e.Commands
		case agent.ReplyDone:
			if !e.CommandOutput {
				t.Errorf("a local command's output is not marked: %q", e.Text)
			}
			printed = append(printed, e.Text)
		case agent.ContextReset:
			reset, resetIdx = i, len(natives)
		case agent.NativeSessionStarted:
			natives = append(natives, e.ID)
		case agent.ReplyDelta:
			t.Errorf("a local command streamed: %+v", e)
		}
	}
	if _, ok := find(changed, "probe-greet"); !ok {
		t.Errorf("changed = %+v", changed)
	}
	if _, ok := find(changed, "doctor"); ok {
		t.Error("a ruled-out command in the change")
	}
	if len(printed) != 2 || printed[1] != "/help isn't available in this environment." {
		t.Errorf("printed = %q", printed)
	}
	if reset < 0 || resetIdx >= len(natives) || natives[len(natives)-1] != "433e1579-24f4-4508-b54f-9cc10f363c9c" {
		t.Errorf("reset at %d, native sessions %v", reset, natives)
	}

	// Told again, as "/compact" does, it is not told twice.
	if evs := p.line(lines[3]); len(evs) != 0 {
		t.Errorf("told again: %+v", evs)
	}
}

// A command goes first, the Agent's own way; then what follows it, and
// the files.
func TestCommandText(t *testing.T) {
	review := &agent.Command{Name: "code-review"}
	for _, c := range []struct {
		turn agent.Turn
		want string
	}{
		{agent.Turn{Command: review}, "/code-review"},
		{agent.Turn{Command: review, Text: "src/"}, "/code-review src/"},
		{agent.Turn{Command: review, Text: "看看", Files: []agent.FileMention{{Path: "/w/a.go", Rel: "a.go"}}}, "/code-review 看看\n\n" + filesHeading + "\n@a.go"},
		{agent.Turn{Text: " /clear 是什么"}, " /clear 是什么"},
	} {
		if got := withFiles(c.turn); got != c.want {
			t.Errorf("%+v: %q, want %q", c.turn, got, c.want)
		}
	}
}
