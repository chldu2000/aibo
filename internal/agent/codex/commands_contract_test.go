package codex_test

// Contract tests of Agent commands with the real codex (AIBO_CONTRACT=1;
// see contract_test.go): .scratch/agent-commands/issues/09.

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

var contractSource = workbench.ModelSource{Path: "codex"}

func writeSkill(t *testing.T, ws, name, body string) {
	t.Helper()
	dir := filepath.Join(ws, ".agents", "skills", name)
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: "+name+"\ndescription: Probe skill. Use only when asked to run "+name+".\n---\n"+body+"\n"), 0o644)
}

func (e *env) commandList(t *testing.T, id string, demand workbench.CommandDemand) []agent.Command {
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

// The skills are told without a thread; one invoked is injected, as
// "$name" and its item; a skill added is told; "/clear" goes on in a new
// thread, and the model never sees it.
func TestContractSkillsAndReset(t *testing.T) {
	path := contract(t)
	ws := t.TempDir()
	writeSkill(t, ws, "probe-greet", "Reply with exactly: GREET followed by the user's argument, and nothing else.")
	e := openEnv(t, t.TempDir(), path)
	defer e.Close()
	w, _ := e.AddWorkspace(ws)
	s, _ := e.NewSession(w.ID, codex.Kind, "")

	cmds := e.commandList(t, s.ID, workbench.LoadCommands)
	greet, ok := named(cmds, "probe-greet")
	if !ok || greet.Source != "repo" || !strings.HasPrefix(greet.Description, "Probe skill") || len(greet.Data) == 0 {
		t.Fatalf("the project's skill = %+v, %v", greet, ok)
	}
	for _, name := range []string{"model", "permissions", "compact", "rename", "new", "clear"} {
		if c, ok := named(cmds, name); !ok || !c.Builtin {
			t.Errorf("%s = %+v, %v", name, c, ok)
		}
	}
	if _, ok := named(cmds, "review"); ok {
		t.Error("/review is offered before its contract test")
	}
	if st := e.Status(s.ID); st.Connected {
		t.Error("a thread started for the commands")
	}

	if err := e.SendMessage(s.ID, workbench.Outgoing{Command: "probe-greet", Text: "Bob"}); err != nil {
		t.Fatal(err)
	}
	ms := e.idle(t, s.ID)
	if r := lastReply(ms); !strings.Contains(r.Text, "GREET Bob") {
		t.Errorf("the skill's reply = %q", r.Text)
	}
	first, _ := e.Session(s.ID)

	// Added while a thread runs: told.
	writeSkill(t, ws, "probe-late", "Reply with exactly: LATE.")
	e.until(t, "the new skill", func() bool {
		_, ok := named(e.CommandList(s.ID, contractSource, workbench.PeekCommands).Commands, "probe-late")
		return ok
	})

	n := len(ms)
	if err := e.SendMessage(s.ID, workbench.Outgoing{Command: "clear"}); err != nil {
		t.Fatal(err)
	}
	ms = e.idle(t, s.ID)
	if len(ms) != n+1 || ms[n].Command == nil || ms[n].Command.Name != "clear" {
		t.Errorf("after /clear: %+v", ms[n:])
	}
	marks := e.Markers(s.ID)
	if len(marks) == 0 || marks[len(marks)-1].Kind != model.Reset || marks[len(marks)-1].AfterSeq != ms[n].Seq {
		t.Errorf("markers = %+v", marks)
	}
	after, _ := e.Session(s.ID)
	if after.NativeID() == "" || after.NativeID() == first.NativeID() {
		t.Errorf("native sessions = %v", after.NativeIDs)
	}

	// The new thread knows nothing of the old.
	if err := e.Send(s.ID, "Did I ask you to greet anyone earlier in this conversation? Reply with only YES or NO."); err != nil {
		t.Fatal(err)
	}
	if r := lastReply(e.idle(t, s.ID)); !strings.Contains(strings.ToUpper(r.Text), "NO") {
		t.Errorf("the new thread remembers: %q", r.Text)
	}
}
