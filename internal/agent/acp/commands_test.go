package acp

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// startWith runs this test binary as a fake ACP Agent of kind, which
// writes the last prompt it got to the returned path.
func startWith(t *testing.T, kind string) (agent.Session, string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	prompt := filepath.Join(dir, "prompt")
	a := New("fake-acp", "Fake ACP", exe, nil, "")
	a.Configure(exe, []string{"AIBO_ACP_FAKE=" + kind, "AIBO_ACP_LOG=" + filepath.Join(dir, "log"), "AIBO_ACP_PROMPT=" + prompt})
	if _, err := a.Commands(t.Context(), dir); !errors.Is(err, agent.ErrCommandsFromSession) {
		t.Fatalf("commands without a session: %v", err)
	}
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, prompt
}

func toldCommands(t *testing.T, s agent.Session) []agent.Command {
	t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case ev := <-s.Events():
			if c, ok := ev.(agent.CommandsChanged); ok {
				return c.Commands
			}
		case <-timeout:
			t.Fatal("no commands told")
		}
	}
}

// Commands told before session/new answers are the session's; one
// invoked starts the prompt, the words after it.
func TestCommandsToldEarly(t *testing.T) {
	s, prompt := startWith(t, "options-commands")
	cmds := toldCommands(t, s)
	if len(cmds) != 2 || cmds[0].Name != "web" || cmds[0].ArgumentHint != "query" || cmds[0].Description != "Search the web" ||
		cmds[0].Handling != agent.ByAgent || cmds[0].Builtin || cmds[1].Name != "init" || cmds[1].ArgumentHint != "" {
		t.Fatalf("commands = %+v", cmds)
	}
	if err := s.Send(t.Context(), agent.Turn{Command: &cmds[0], Text: "agent client protocol", Files: []agent.FileMention{{Path: "/w/a.go", Rel: "a.go"}}}); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Params struct {
			Prompt []struct{ Type, Text string }
		}
	}
	for i := 0; i < 200; i++ {
		b, _ := os.ReadFile(prompt)
		if json.Unmarshal(b, &got) == nil && len(got.Params.Prompt) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if p := got.Params.Prompt; len(p) != 1 || p[0].Type != "text" || p[0].Text != "/web agent client protocol\na.go" {
		t.Errorf("prompt = %+v", p)
	}
}

// An Agent that tells no commands has none, soon after it starts.
func TestNoCommandsTold(t *testing.T) {
	defer func(d time.Duration) { noCommandsAfter = d }(noCommandsAfter)
	noCommandsAfter = 50 * time.Millisecond
	s, _ := startWith(t, "options")
	if cmds := toldCommands(t, s); cmds == nil || len(cmds) != 0 {
		t.Errorf("commands = %+v", cmds)
	}
}

// Told after the fallback, the Agent's list replaces the empty one; told
// first, no empty one follows.
func TestCommandsAfterFallback(t *testing.T) {
	defer func(d time.Duration) { noCommandsAfter = d }(noCommandsAfter)
	noCommandsAfter = 10 * time.Millisecond
	s := &session{events: make(chan agent.Event, 8), log: agent.Discard, stopping: make(chan struct{}), commands: commandsTold{ch: make(chan struct{})}}
	s.awaitCommands()
	if c := (<-s.events).(agent.CommandsChanged); len(c.Commands) != 0 {
		t.Fatalf("fallback = %+v", c)
	}
	s.update(json.RawMessage(`{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"web","description":"d"},{"name":"web","description":"again"},{"name":"","description":"none"}]}`), 0)
	if c := (<-s.events).(agent.CommandsChanged); len(c.Commands) != 1 || c.Commands[0].Description != "d" {
		t.Fatalf("told = %+v", c)
	}

	s = &session{events: make(chan agent.Event, 8), log: agent.Discard, stopping: make(chan struct{}), commands: commandsTold{ch: make(chan struct{})}}
	s.update(json.RawMessage(`{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"web","description":"d"}]}`), 0)
	s.awaitCommands()
	<-s.events
	time.Sleep(50 * time.Millisecond)
	if len(s.events) != 0 {
		t.Errorf("an empty list followed: %+v", <-s.events)
	}
}

// What the Cursor CLI 2026.11.22 told of its commands.
func TestCursorCommandsCapture(t *testing.T) {
	f, err := os.Open("testdata/cursor-2026.11.22-turns.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		var line struct{ Frame envelope }
		json.Unmarshal(sc.Bytes(), &line)
		var p struct{ Update json.RawMessage }
		var tag struct{ SessionUpdate string }
		if json.Unmarshal(line.Frame.Params, &p) != nil || json.Unmarshal(p.Update, &tag) != nil || tag.SessionUpdate != "available_commands_update" {
			continue
		}
		cmds, ok := offered(p.Update)
		if !ok || len(cmds) < 50 {
			t.Fatalf("%d commands", len(cmds))
		}
		for _, c := range cmds {
			if c.Name == "" || c.Handling != agent.ByAgent {
				t.Errorf("command %+v", c)
			}
		}
		return
	}
	t.Fatal("no available_commands_update")
}
