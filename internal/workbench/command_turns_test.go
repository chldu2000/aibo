package workbench_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

var clearCmd = agent.Command{Name: "clear", Aliases: []string{"reset"}, Description: "Clear the context", Builtin: true, Handling: agent.ByReset}

// withCommands is a session whose Agent told cmds, without a session.
func withCommands(t *testing.T, b *bench, cmds ...agent.Command) model.Session {
	_, s := withCommandsIn(t, b, cmds...)
	return s
}

func withCommandsIn(t *testing.T, b *bench, cmds ...agent.Command) (model.Workspace, model.Session) {
	t.Helper()
	b.fake.SetCommands(cmds, false)
	ws, s := newSession(t, b)
	b.CommandList(s.ID, src, workbench.LoadCommands)
	b.waitCommands(t, s.ID)
	return ws, s
}

func slashReason(t *testing.T, err error) workbench.SlashReason {
	t.Helper()
	var e *workbench.SlashCommandError
	if !errors.As(err, &e) || !errors.Is(err, workbench.ErrSlashCommand) {
		t.Fatalf("err = %v", err)
	}
	if e.Agent != "假 Agent" {
		t.Errorf("agent = %q", e.Agent)
	}
	return e.Reason
}

// A command goes to the Agent as the Agent told it, under its own name,
// and the message keeps it, with what it was said to do.
func TestSendCommand(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	ws, s := withCommandsIn(t, b, reviewCmd, initCmd)
	if err := b.SendMessage(s.ID, workbench.Outgoing{Command: "code-review", Text: " src/ ",
		Mentions: []model.Mention{{Path: filepath.Join(ws.Path, "a.go"), WorkspaceID: ws.ID}}}); err != nil {
		t.Fatal(err)
	}
	sc.emit(agent.ReplyDelta{ReplyID: "a", Text: "看过了"}, agent.ReplyDone{ReplyID: "a"})
	sc.endTurn()
	b.idle(t, s.ID)

	turns, _ := sc.received()
	if len(turns) != 1 || turns[0].Command == nil || turns[0].Command.Name != "review" || turns[0].Text != "src/" || len(turns[0].Files) != 1 {
		t.Fatalf("the Agent got %+v", turns)
	}
	ms := b.messages(t, s.ID)
	want := model.CommandCall{Name: "review", Description: "Review the diff"}
	if ms[0].Command == nil || *ms[0].Command != want || ms[0].Text != "src/" {
		t.Errorf("message = %+v", ms[0])
	}
	if got, _ := b.Session(s.ID); got.Title != "/review src/" {
		t.Errorf("title = %q", got.Title)
	}
	if ms := b.Markers(s.ID); len(ms) != 0 {
		t.Errorf("a command that replied got markers: %+v", ms)
	}
	b.Close()

	// Kept.
	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	if ms := b2.messages(t, s.ID); ms[0].Command == nil || *ms[0].Command != want {
		t.Errorf("after reopening: %+v", ms[0])
	}
}

// A command needs no words after it; one the Agent no longer tells goes
// as it is, for the Agent to say.
func TestSendBareAndUnknownCommand(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	s := withCommands(t, b, initCmd)
	converseCommand(t, b, sc, s.ID, "init")
	converseCommand(t, b, sc, s.ID, "gone")
	turns, _ := sc.received()
	if len(turns) != 2 || turns[0].Command.Name != "init" || !turns[0].Command.Builtin || turns[1].Command.Name != "gone" {
		t.Errorf("the Agent got %+v", turns)
	}
	ms := b.messages(t, s.ID)
	if len(ms) != 2 || ms[0].Command.Name != "init" || ms[0].Text != "" || ms[1].Command.Name != "gone" || ms[1].Command.Description != "" {
		t.Errorf("messages = %+v", ms)
	}
}

func converseCommand(t *testing.T, b *bench, sc *script, id, name string) {
	t.Helper()
	if err := b.SendMessage(id, workbench.Outgoing{Command: name}); err != nil {
		t.Fatal(err)
	}
	sc.endTurn()
	b.idle(t, id)
}

// "/word" that is no command is not sent; one that is, invokes it; a
// space before it, a path, or a slash elsewhere go as words.
func TestSlashWords(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	s := withCommands(t, b, reviewCmd)
	for _, text := range []string{"/clear", "/model sonnet", "/review:pr 12"} {
		if r := slashReason(t, b.Send(s.ID, text)); r != workbench.NotACommand {
			t.Errorf("%q: reason %v", text, r)
		}
	}
	if n := len(b.messages(t, s.ID)); n != 0 {
		t.Errorf("%d messages recorded", n)
	}

	converse(t, b, sc, s.ID, "/code-review src/")
	for _, text := range []string{"  /clear 是什么", "/Users/me/project 里有什么", "看看 /clear 是什么命令"} {
		converse(t, b, sc, s.ID, text)
	}
	turns, _ := sc.received()
	if c := turns[0].Command; c == nil || c.Name != "review" || turns[0].Text != "src/" {
		t.Errorf("/code-review went as %+v", turns[0])
	}
	if turns[1].Command != nil || turns[1].Text != " /clear 是什么" {
		t.Errorf("with a space before it, it went as %+v", turns[1])
	}
	for _, tn := range turns[2:] {
		if tn.Command != nil || tn.Text[0] == ' ' {
			t.Errorf("went as %+v", tn)
		}
	}
	if ms := b.messages(t, s.ID); ms[1].Text != "/clear 是什么" || ms[1].Command != nil {
		t.Errorf("recorded as %+v", ms[1])
	}
}

// Without the Agent's commands, "/word" cannot be checked.
func TestSlashWordsWithoutCommands(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	_, s := newSession(t, b)
	if r := slashReason(t, b.Send(s.ID, "/review")); r != workbench.CommandsUnknown {
		t.Errorf("not asked yet: %v", r)
	}
	b.fake.FailCommands(errors.New("no"))
	b.CommandList(s.ID, src, workbench.LoadCommands)
	b.waitCommands(t, s.ID)
	if r := slashReason(t, b.Send(s.ID, "/review")); r != workbench.CommandsUnknown {
		t.Errorf("failed: %v", r)
	}
}

// A command that ran and said nothing is marked so; one that failed, or
// was stopped, is not.
func TestCommandThatSaidNothing(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	s := withCommands(t, b, initCmd)
	converseCommand(t, b, sc, s.ID, "init")
	if ms := b.Markers(s.ID); len(ms) != 1 || ms[0].Kind != model.CommandRan || ms[0].AfterSeq != 1 {
		t.Fatalf("markers = %+v", ms)
	}

	if err := b.SendMessage(s.ID, workbench.Outgoing{Command: "init"}); err != nil {
		t.Fatal(err)
	}
	sc.emit(agent.Failed{Message: "isn't available in this environment"})
	sc.endTurn()
	b.idle(t, s.ID)
	if err := b.SendMessage(s.ID, workbench.Outgoing{Command: "init"}); err != nil {
		t.Fatal(err)
	}
	b.Stop(s.ID)
	b.idle(t, s.ID)
	// Nor are the words that followed.
	converse(t, b, sc, s.ID, "hi")
	if ms := b.Markers(s.ID); len(ms) != 1 {
		t.Errorf("markers = %+v", ms)
	}
}

// What an Agent command printed is marked as such.
func TestCommandOutput(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	s := withCommands(t, b, agent.Command{Name: "context", Builtin: true})
	if err := b.SendMessage(s.ID, workbench.Outgoing{Command: "context"}); err != nil {
		t.Fatal(err)
	}
	sc.emit(agent.ReplyDone{ReplyID: "a", Text: "Context: 12k tokens", CommandOutput: true})
	sc.endTurn()
	b.idle(t, s.ID)
	converse(t, b, sc, s.ID, "hi", "hello")
	check := func(ms []model.Message) {
		t.Helper()
		if len(ms) != 4 || !ms[1].CommandOutput || ms[1].Text != "Context: 12k tokens" || ms[3].CommandOutput {
			t.Errorf("messages = %+v", ms)
		}
	}
	check(b.messages(t, s.ID))
	if ms := b.Markers(s.ID); len(ms) != 0 {
		t.Errorf("markers = %+v", ms)
	}
	b.Close()
	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	check(b2.messages(t, s.ID))
}

// An Agent clearing its context starts a new native session, which the
// session resumes from then on; it is marked, and still the same session.
func TestContextReset(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	s := withCommands(t, b, clearCmd)
	converse(t, b, sc, s.ID, "hi", "hello")
	if err := b.SendMessage(s.ID, workbench.Outgoing{Command: "reset"}); err != nil {
		t.Fatal(err)
	}
	sc.emit(agent.ContextReset{}, agent.NativeSessionStarted{ID: "after-clear"})
	sc.endTurn()
	b.idle(t, s.ID)

	if turns, _ := sc.received(); turns[1].Command == nil || turns[1].Command.Name != "clear" {
		t.Errorf("the Agent got %+v", turns[1])
	}
	if ms := b.Markers(s.ID); len(ms) != 1 || ms[0].Kind != model.Reset || ms[0].AfterSeq != 3 {
		t.Errorf("markers = %+v", ms)
	}
	if got, _ := b.Session(s.ID); got.NativeID() != "after-clear" {
		t.Errorf("native sessions = %v", got.NativeIDs)
	}
	b.Close()

	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	if err := b2.Send(s.ID, "again"); err != nil {
		t.Fatal(err)
	}
	if starts := b2.fake.Starts(); len(starts) != 1 || starts[0].ResumeID != "after-clear" {
		t.Errorf("resumed %+v", starts)
	}
}
