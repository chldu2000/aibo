package contract

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	registry "github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

// The Cursor CLI tells its commands, a project's too, as a session
// starts; one invoked as "/name" at the start of the prompt runs, and is
// not words to the model, which could not know what the command says
// (.scratch/agent-extensibility/issues/06).
func TestContractCursorCommands(t *testing.T) {
	r, st, _ := cursor(t)
	ws := t.TempDir()
	os.MkdirAll(filepath.Join(ws, ".cursor", "commands"), 0o755)
	if err := os.WriteFile(filepath.Join(ws, ".cursor", "commands", "probe-hello.md"),
		[]byte("Reply with exactly the code HELLO-PROBE-41 and nothing else. Do not use any tools.\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e := openEnv(t, t.TempDir(), r.Agents())
	defer e.Close()
	space, err := e.AddWorkspace(ws)
	if err != nil {
		t.Fatal(err)
	}
	x, err := e.NewSession(space.ID, registry.Cursor, "")
	if err != nil {
		t.Fatal(err)
	}
	if !e.TellsCommands(registry.Cursor) {
		t.Fatal("the Cursor CLI tells no commands")
	}
	source := workbench.ModelSource{Path: st.Path, Version: st.Version, Auth: st.Auth}
	e.CommandList(x.ID, source, workbench.LoadCommands)
	var l workbench.CommandList
	e.until(func() bool {
		l = e.CommandList(x.ID, source, workbench.PeekCommands)
		return !l.Loading && (l.Commands != nil || l.Err != nil)
	})
	if l.Err != nil {
		t.Fatalf("commands: %v", l.Err)
	}
	t.Logf("%d commands", len(l.Commands))
	i := slices.IndexFunc(l.Commands, func(c agent.Command) bool { return c.Name == "probe-hello" })
	if i < 0 {
		var names []string
		for _, c := range l.Commands {
			names = append(names, c.Name)
		}
		t.Fatalf("no project command among %v", names)
	}
	if c := l.Commands[i]; c.Handling != agent.ByAgent || c.Builtin {
		t.Errorf("probe-hello = %+v", c)
	}
	if got, _ := e.Session(x.ID); got.NativeID() == "" {
		t.Error("no native session after the commands")
	}

	if err := e.SendMessage(x.ID, workbench.Outgoing{Command: "probe-hello"}); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return !e.Status(x.ID).Running })
	if st := e.Status(x.ID); st.Error != nil {
		t.Fatalf("turn error: %v", st.Error)
	}
	ms, _ := e.Messages(x.ID)
	var reply string
	for _, m := range ms {
		if m.Kind == model.AgentReply {
			reply += m.Text
		}
	}
	if ms[0].Command == nil || ms[0].Command.Name != "probe-hello" {
		t.Errorf("the message = %+v", ms[0])
	}
	if !strings.Contains(reply, "HELLO-PROBE-41") {
		t.Errorf("the command did not run; the reply = %q", reply)
	}
}
