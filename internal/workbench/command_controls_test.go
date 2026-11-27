package workbench_test

import (
	"errors"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

var controlCmds = []agent.Command{
	{Name: "model", Builtin: true, Handling: agent.ByModel},
	{Name: "effort", Builtin: true, Handling: agent.ByEffort},
	{Name: "compact", Builtin: true, Handling: agent.ByCompact},
	{Name: "rename", Aliases: []string{"name"}, Builtin: true, Handling: agent.ByRename},
	{Name: "permissions", Builtin: true, Handling: agent.ByMode},
}

func invoke(b *bench, id, name, arg string) error {
	return b.SendMessage(id, workbench.Outgoing{Command: name, Text: arg})
}

func pick(t *testing.T, err error) agent.Handling {
	t.Helper()
	var p *workbench.PickError
	if !errors.As(err, &p) || !errors.Is(err, workbench.ErrPick) {
		t.Fatalf("err = %v", err)
	}
	return p.Control
}

// Commands the workbench's controls carry out do what the controls do,
// with no turn and no message.
func TestCommandsByControls(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	s := withCommands(t, b, controlCmds...) // on "fake-model"
	converse(t, b, sc, s.ID, "一", "回复一")

	if err := invoke(b, s.ID, "model", "m2"); err != nil {
		t.Fatal(err)
	}
	if err := b.SetModel(s.ID, "m2", "low"); err != nil {
		t.Fatal(err)
	}
	if err := invoke(b, s.ID, "effort", "high"); err != nil {
		t.Fatal(err)
	}
	if got := b.fake.ModelSets(); len(got) != 3 || got[0] != (fake.ModelSet{Model: "m2"}) || got[2] != (fake.ModelSet{Model: "m2", Effort: "high"}) {
		t.Errorf("model sets = %+v", got)
	}
	b.waitFor(t, "the Agent to report", func() bool { return b.Status(s.ID).Effort == "high" })

	if err := invoke(b, s.ID, "permissions", "Edits"); err != nil {
		t.Fatal(err)
	}
	if got := <-b.fake.Modes(); got != fake.ModeEdits {
		t.Errorf("mode = %q", got)
	}
	if err := invoke(b, s.ID, "permissions", "auto"); err != nil {
		t.Fatal(err)
	}
	if got, _ := b.Session(s.ID); got.Mode != fake.ModeAuto {
		t.Errorf("mode = %q", got.Mode)
	}
	if err := invoke(b, s.ID, "permissions", "yolo"); !errors.Is(err, workbench.ErrNoSuchMode) {
		t.Errorf("no such mode: %v", err)
	}

	if err := invoke(b, s.ID, "name", "我的会话"); err != nil {
		t.Fatal(err)
	}
	if got, _ := b.Session(s.ID); got.Title != "我的会话" || !got.TitleManual {
		t.Errorf("title = %q", got.Title)
	}
	if err := invoke(b, s.ID, "rename", ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := b.Session(s.ID); got.Title != "一" || got.TitleManual {
		t.Errorf("title back = %q", got.Title)
	}

	if err := invoke(b, s.ID, "compact", ""); err != nil {
		t.Fatal(err)
	}
	b.idle(t, s.ID)
	if ms := b.Markers(s.ID); len(ms) != 1 || ms[0].Kind != model.Compaction || ms[0].Trigger != "manual" {
		t.Errorf("markers = %+v", ms)
	}

	// Without a choice, the user chooses with the control.
	for name, want := range map[string]agent.Handling{"model": agent.ByModel, "effort": agent.ByEffort, "permissions": agent.ByMode} {
		if got := pick(t, invoke(b, s.ID, name, "")); got != want {
			t.Errorf("/%s: pick %q", name, got)
		}
	}

	if turns, _ := sc.received(); len(turns) != 1 {
		t.Errorf("turns = %+v", turns)
	}
	if ms := b.messages(t, s.ID); len(ms) != 2 {
		t.Errorf("messages = %+v", ms)
	}
}

// What the controls refuse, the commands do too.
func TestCommandsByControlsRefused(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	s := withCommands(t, b, controlCmds...)
	if err := invoke(b, s.ID, "compact", ""); !errors.Is(err, workbench.ErrNothingToCompact) {
		t.Errorf("compacting nothing: %v", err)
	}
	if err := b.Send(s.ID, "long"); err != nil {
		t.Fatal(err)
	}
	if err := invoke(b, s.ID, "model", "m3"); !errors.Is(err, workbench.ErrTurnRunning) {
		t.Errorf("while running: %v", err)
	}
	sc.endTurn()
	b.idle(t, s.ID)
}
