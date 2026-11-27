package claude_test

// Contract tests of Agent commands with the real claude (AIBO_CONTRACT=1;
// see contract_test.go): .scratch/agent-commands/issues/08.

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

var contractSource = workbench.ModelSource{Path: "claude"}

// commandWorkspace has a project command, and a SessionStart hook that
// leaves a file when it runs.
func commandWorkspace(t *testing.T) string {
	t.Helper()
	ws := t.TempDir()
	os.MkdirAll(filepath.Join(ws, ".claude", "commands"), 0o755)
	os.WriteFile(filepath.Join(ws, ".claude", "commands", "probe-hello.md"),
		[]byte("---\ndescription: Probe command that says hello\nargument-hint: <name>\n---\nReply with exactly: HELLO $ARGUMENTS\n"), 0o644)
	os.WriteFile(filepath.Join(ws, ".claude", "settings.json"),
		[]byte(`{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo ran >> hook-ran.txt"}]}]}}`), 0o644)
	return ws
}

func (e *env) commands(t *testing.T, id string, demand workbench.CommandDemand) []agent.Command {
	t.Helper()
	e.CommandList(id, contractSource, demand)
	var l workbench.CommandList
	e.until(t, "the commands", func() bool {
		l = e.CommandList(id, contractSource, workbench.PeekCommands)
		return !l.Loading && (l.Commands != nil || l.Err != nil)
	})
	if l.Err != nil {
		t.Fatalf("commands: %v", l.Err)
	}
	return l.Commands
}

func named(cmds []agent.Command, name string) (agent.Command, bool) {
	i := slices.IndexFunc(cmds, func(c agent.Command) bool { return c.Name == name })
	if i < 0 {
		return agent.Command{}, false
	}
	return cmds[i], true
}

// conversed are the session records Claude Code keeps for a workspace
// (~/.claude/projects/<its path, each other character a "-">) that hold
// any of the conversation: a user message.
func conversed(t *testing.T, ws string) []string {
	t.Helper()
	home, _ := os.UserHomeDir()
	enc := regexp.MustCompile(`[^A-Za-z0-9]`).ReplaceAllString(ws, "-")
	var out []string
	files, _ := filepath.Glob(filepath.Join(home, ".claude", "projects", enc, "*.jsonl"))
	for _, f := range files {
		if b, _ := os.ReadFile(f); strings.Contains(string(b), `"type":"user"`) {
			out = append(out, f)
		}
	}
	return out
}

// hookRuns counts the SessionStart hook's runs.
func hookRuns(ws string) int {
	b, _ := os.ReadFile(filepath.Join(ws, "hook-ran.txt"))
	return strings.Count(string(b), "ran")
}

// Asked for before a message, the commands come from the session's own
// process, which then takes the message. It names no native session
// before the message, and keeps none of the conversation; it runs the
// SessionStart hook as it starts, once, not again with the message
// (Claude Code 2.1.332). Resumed, it tells them as well.
func TestContractCommandList(t *testing.T) {
	path := contract(t)
	dir, ws := t.TempDir(), commandWorkspace(t)
	e := openEnv(t, dir, path)
	w, _ := e.AddWorkspace(ws)
	s, _ := e.NewSession(w.ID, claude.Kind, contractModel)

	cmds := e.commands(t, s.ID, workbench.LoadCommands)
	hello, ok := named(cmds, "probe-hello")
	if !ok || hello.Builtin || hello.ArgumentHint != "<name>" || !strings.HasPrefix(hello.Description, "Probe command that says hello") {
		t.Errorf("the project's command = %+v, %v", hello, ok)
	}
	for name, want := range map[string]agent.Handling{"init": agent.ByAgent, "model": agent.ByModel, "clear": agent.ByReset, "context": agent.ByAgent} {
		if c, ok := named(cmds, name); !ok || c.Handling != want || !c.Builtin {
			t.Errorf("%s = %+v, %v", name, c, ok)
		}
	}
	for _, name := range []string{"doctor", "mcp", "config"} {
		if _, ok := named(cmds, name); ok {
			t.Errorf("%s is offered", name)
		}
	}
	if st := e.Status(s.ID); !st.Connected {
		t.Error("no native session runs")
	}
	time.Sleep(2 * time.Second) // for a hook, had it run
	if got, _ := e.Session(s.ID); got.NativeID() != "" {
		t.Errorf("a native session before any message: %q", got.NativeID())
	}
	if n := hookRuns(ws); n > 1 {
		t.Errorf("the SessionStart hook ran %d times before any message", n)
	}
	if got := conversed(t, ws); len(got) != 0 {
		t.Errorf("the conversation kept before any message: %v", got)
	}

	ms := e.turn(t, s.ID, "Reply with just OK")
	if last := ms[len(ms)-1]; last.Kind != model.AgentReply {
		t.Fatalf("last = %+v", last)
	}
	first, _ := e.Session(s.ID)
	if first.NativeID() == "" {
		t.Fatal("no native session after the message")
	}
	if n := hookRuns(ws); n != 1 {
		t.Errorf("the SessionStart hook ran %d times by the first message", n)
	}
	if got := conversed(t, ws); len(got) != 1 {
		t.Errorf("records of the conversation: %v", got)
	}
	e.Close()

	// Resumed for the commands.
	e2 := openEnv(t, dir, path)
	defer e2.Close()
	if _, ok := named(e2.commands(t, s.ID, workbench.LoadCommands), "probe-hello"); !ok {
		t.Error("resumed, it told no project command")
	}
	e2.turn(t, s.ID, "Reply with just OK again")
	if got, _ := e2.Session(s.ID); got.NativeID() != first.NativeID() {
		t.Errorf("resumed %q, want %q", got.NativeID(), first.NativeID())
	}
}

// Commands run as Claude Code runs them: a prompt as a turn, a local one
// printing, "/clear" starting a new native session; a space before
// "/word" makes it words.
func TestContractCommandTurns(t *testing.T) {
	path := contract(t)
	dir, ws := t.TempDir(), commandWorkspace(t)
	e := openEnv(t, dir, path)
	defer e.Close()
	w, _ := e.AddWorkspace(ws)
	s, _ := e.NewSession(w.ID, claude.Kind, contractModel)
	e.commands(t, s.ID, workbench.LoadCommands)

	send := func(o workbench.Outgoing) []model.Message {
		t.Helper()
		if err := e.SendMessage(s.ID, o); err != nil {
			t.Fatal(err)
		}
		e.until(t, "the turn to end", func() bool { return !e.Status(s.ID).Running })
		if st := e.Status(s.ID); st.Error != nil {
			t.Fatalf("Claude Code reported: %s", st.Error)
		}
		ms, _ := e.Messages(s.ID)
		return ms
	}

	ms := send(workbench.Outgoing{Command: "probe-hello", Text: "world"})
	if last := ms[len(ms)-1]; last.Kind != model.AgentReply || last.CommandOutput || !strings.Contains(last.Text, "HELLO world") {
		t.Errorf("the prompt's reply = %+v", last)
	}
	if ms[0].Command == nil || ms[0].Command.Name != "probe-hello" || ms[0].Text != "world" {
		t.Errorf("the message = %+v", ms[0])
	}

	n := len(ms)
	ms = send(workbench.Outgoing{Command: "context"})
	if len(ms) != n+2 || !ms[n+1].CommandOutput || !strings.Contains(ms[n+1].Text, "Context") {
		t.Errorf("/context = %+v", ms[n:])
	}

	// Compacting tells the earlier output again: not twice here.
	if err := e.Compact(s.ID); err != nil {
		t.Fatal(err)
	}
	e.until(t, "the compaction", func() bool { return !e.Status(s.ID).Running })
	ms, _ = e.Messages(s.ID)
	if outs := slices.DeleteFunc(slices.Clone(ms), func(m model.Message) bool { return !m.CommandOutput }); len(outs) != 1 {
		t.Errorf("command output after compacting: %+v", outs)
	}

	// Words, not a command: the model answers.
	n = len(ms)
	ms = send(workbench.Outgoing{Text: " /context is a command; reply with just the word WORDS"})
	if last := ms[len(ms)-1]; len(ms) != n+2 || last.CommandOutput || !strings.Contains(last.Text, "WORDS") {
		t.Errorf("with a space before it: %+v", ms[n:])
	}

	before, _ := e.Session(s.ID)
	ms = send(workbench.Outgoing{Command: "clear"})
	marks := e.Markers(s.ID)
	if len(marks) == 0 || marks[len(marks)-1].Kind != model.Reset || marks[len(marks)-1].AfterSeq != ms[len(ms)-1].Seq {
		t.Errorf("markers after /clear: %+v", marks)
	}
	// The new native session is named by the next turn's system/init.
	send(workbench.Outgoing{Text: "Reply with just OK"})
	after, _ := e.Session(s.ID)
	if after.NativeID() == "" || after.NativeID() == before.NativeID() {
		t.Errorf("native sessions = %v", after.NativeIDs)
	}
}
