package workbench_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
)

var (
	reviewCmd = agent.Command{Name: "review", Aliases: []string{"code-review"}, Description: "Review the diff", ArgumentHint: "[path]"}
	initCmd   = agent.Command{Name: "init", Description: "Write AGENTS.md", Builtin: true}
	greetCmd  = agent.Command{Name: "greet", Description: "Say hello", Source: "repo"}
	src       = workbench.ModelSource{Path: "/bin/fake", Version: "1"}
)

func names(l workbench.CommandList) []string {
	var ns []string
	for _, c := range l.Commands {
		ns = append(ns, c.Name)
	}
	return ns
}

// waitCommands waits until the session's commands are told, and returns
// them.
func (b *bench) waitCommands(t *testing.T, id string) workbench.CommandList {
	t.Helper()
	var l workbench.CommandList
	b.waitFor(t, "the commands", func() bool {
		l = b.CommandList(id, src, workbench.PeekCommands)
		return !l.Loading && (l.Commands != nil || l.Err != nil)
	})
	return l
}

// An Agent that tells its commands without a session (Codex): asked once,
// shared by the sessions of a workspace, and no native session starts.
func TestCommandsWithoutSession(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	b.fake.SetCommands([]agent.Command{reviewCmd, initCmd}, false)
	ws, s := newSession(t, b)
	if !b.TellsCommands(fake.Kind) {
		t.Fatal("the fake tells its commands")
	}

	if l := b.CommandList(s.ID, src, workbench.PeekCommands); l.Loading || l.Commands != nil || b.fake.CommandLists() != 0 {
		t.Fatalf("a peek asked, or knew: %+v", l)
	}
	if l := b.CommandList(s.ID, src, workbench.LoadCommands); !l.Loading {
		t.Fatalf("not loading: %+v", l)
	}
	l := b.waitCommands(t, s.ID)
	if got := names(l); !slices.Equal(got, []string{"review", "init"}) || l.Err != nil {
		t.Fatalf("commands = %v, %v", got, l.Err)
	}
	if l.Commands[0].ArgumentHint != "[path]" || !l.Commands[0].Answers("code-review") {
		t.Errorf("review = %+v", l.Commands[0])
	}
	if n := len(b.fake.Starts()); n != 0 {
		t.Errorf("%d native sessions started", n)
	}

	// Another session of the workspace has them already.
	s2, err := b.NewSession(ws.ID, fake.Kind, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := names(b.CommandList(s2.ID, src, workbench.LoadCommands)); !slices.Equal(got, []string{"review", "init"}) {
		t.Errorf("the other session's = %v", got)
	}
	if n := b.fake.CommandLists(); n != 1 {
		t.Errorf("asked %d times", n)
	}

	// Another workspace asks for its own.
	_, s3 := newSession(t, b)
	b.CommandList(s3.ID, src, workbench.LoadCommands)
	b.waitCommands(t, s3.ID)
	if n := b.fake.CommandLists(); n != 2 {
		t.Errorf("asked %d times, with another workspace", n)
	}

	// Signed in again, or another installation: asked again.
	b.fake.SetCommands([]agent.Command{greetCmd}, false)
	other := workbench.ModelSource{Path: "/bin/fake", Version: "2"}
	if l := b.CommandList(s.ID, other, workbench.LoadCommands); !l.Loading || l.Commands != nil {
		t.Fatalf("another source kept the list: %+v", l)
	}
	b.waitFor(t, "the commands again", func() bool {
		return !b.CommandList(s.ID, other, workbench.PeekCommands).Loading
	})
	if got := b.CommandList(s.ID, other, workbench.PeekCommands); !slices.Equal(names(got), []string{"greet"}) || got.Commands[0].Source != "repo" {
		t.Errorf("after the source changed: %+v", got)
	}
}

// Refreshing shows what is known meanwhile, and tells the new list.
func TestCommandsRefresh(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	b.fake.SetCommands([]agent.Command{reviewCmd}, false)
	_, s := newSession(t, b)
	b.CommandList(s.ID, src, workbench.LoadCommands)
	b.waitCommands(t, s.ID)

	b.fake.SetCommands([]agent.Command{reviewCmd, greetCmd}, false)
	if l := b.CommandList(s.ID, src, workbench.LoadCommands); l.Loading || len(l.Commands) != 1 {
		t.Errorf("a load asked again: %+v", l)
	}
	if l := b.CommandList(s.ID, src, workbench.RefreshCommands); !l.Loading || !slices.Equal(names(l), []string{"review"}) {
		t.Errorf("refreshing: %+v", l)
	}
	b.waitFor(t, "the new list", func() bool {
		return len(b.CommandList(s.ID, src, workbench.PeekCommands).Commands) == 2
	})
}

// A failure is kept until the user asks again (RefreshCommands).
func TestCommandsFailure(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	why := errors.New("skills/list failed")
	b.fake.FailCommands(why)
	_, s := newSession(t, b)
	b.CommandList(s.ID, src, workbench.LoadCommands)
	if l := b.waitCommands(t, s.ID); !errors.Is(l.Err, why) {
		t.Fatalf("err = %v", l.Err)
	}
	if l := b.CommandList(s.ID, src, workbench.LoadCommands); !errors.Is(l.Err, why) || b.fake.CommandLists() != 1 {
		t.Errorf("a load retried: %+v", l)
	}

	b.fake.FailCommands(nil)
	b.fake.SetCommands([]agent.Command{initCmd}, false)
	if l := b.CommandList(s.ID, src, workbench.RefreshCommands); !l.Loading || l.Err != nil {
		t.Errorf("retrying: %+v", l)
	}
	b.waitFor(t, "the retry", func() bool {
		return len(b.CommandList(s.ID, src, workbench.PeekCommands).Commands) == 1
	})
}

// An Agent that tells its commands only from a session (Claude Code):
// the session's own native session starts for it, without a message, and
// the next message goes on in it.
func TestCommandsFromSession(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	b.fake.SetCommands([]agent.Command{reviewCmd, initCmd}, true)
	ws, s := newSession(t, b)

	b.CommandList(s.ID, src, workbench.LoadCommands)
	l := b.waitCommands(t, s.ID)
	if got := names(l); !slices.Equal(got, []string{"review", "init"}) || l.Err != nil {
		t.Fatalf("commands = %v, %v", got, l.Err)
	}
	if n := len(b.fake.Starts()); n != 1 {
		t.Fatalf("%d native sessions started", n)
	}
	if ms := b.messages(t, s.ID); len(ms) != 0 {
		t.Errorf("messages = %+v", ms)
	}
	if st := b.Status(s.ID); !st.Connected || st.Running {
		t.Errorf("status = %+v", st)
	}

	converse(t, b, sc, s.ID, "hi", "hello")
	if n := len(b.fake.Starts()); n != 1 {
		t.Errorf("the message started another native session: %d", n)
	}

	// Told as they change; the workspace's other sessions see them too.
	b.fake.ChangeCommands([]agent.Command{greetCmd})
	b.waitFor(t, "the change", func() bool {
		return slices.Equal(names(b.CommandList(s.ID, src, workbench.PeekCommands)), []string{"greet"})
	})
	s2, err := b.NewSession(ws.ID, fake.Kind, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := names(b.CommandList(s2.ID, src, workbench.PeekCommands)); !slices.Equal(got, []string{"greet"}) {
		t.Errorf("the other session's = %v", got)
	}
}

// A session that cannot start its native session cannot tell them.
func TestCommandsFromSessionThatCannotStart(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	b.fake.SetCommands([]agent.Command{reviewCmd}, true)
	b.fake.FailStarts(agent.ErrNotLoggedIn)
	_, s := newSession(t, b)
	b.CommandList(s.ID, src, workbench.LoadCommands)
	if l := b.waitCommands(t, s.ID); !errors.Is(l.Err, agent.ErrNotLoggedIn) {
		t.Errorf("err = %v", l.Err)
	}
	if st := b.Status(s.ID); st.Connected || st.Running || st.Error != nil {
		t.Errorf("status = %+v", st)
	}
}

// A message sent while the native session starts for the commands waits
// for it, and goes on in it.
func TestMessageWhileStartingForCommands(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	b.fake.SetCommands([]agent.Command{reviewCmd}, true)
	_, s := newSession(t, b)
	b.CommandList(s.ID, src, workbench.LoadCommands)
	converse(t, b, sc, s.ID, "hi", "hello")
	b.waitCommands(t, s.ID)
	if n := len(b.fake.Starts()); n != 1 {
		t.Errorf("%d native sessions started", n)
	}
}
