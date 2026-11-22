package workbench_test

import (
	"errors"
	"testing"

	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
)

// Between turns the model and the reasoning effort change, for the turns
// to come and after a restart; while a turn runs they do not. What the
// Agent says it uses is the session's status.
func TestSetModel(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b) // on "fake-model"
	converse(t, b, sc, s.ID, "hi")
	if st := b.Status(s.ID); st.Model != "fake-model" || st.Effort != "" {
		t.Errorf("reported at start: %q %q", st.Model, st.Effort)
	}

	// Idle: the native session changes at once, and says so.
	if err := b.SetModel(s.ID, "m2", "high"); err != nil {
		t.Fatal(err)
	}
	if got := b.fake.ModelSets(); len(got) != 1 || got[0] != (fake.ModelSet{Model: "m2", Effort: "high"}) {
		t.Errorf("the native session got %+v", got)
	}
	b.waitFor(t, "the Agent to report", func() bool { return b.Status(s.ID).Model == "m2" })
	if st := b.Status(s.ID); st.Effort != "high" {
		t.Errorf("reported effort %q", st.Effort)
	}
	if got, _ := b.Session(s.ID); got.Model != "m2" || got.Effort != "high" {
		t.Errorf("session = %q %q", got.Model, got.Effort)
	}
	converse(t, b, sc, s.ID, "again")
	if _, opts := sc.received(); opts.Model != "m2" || opts.Effort != "high" {
		t.Errorf("the next turn ran on %q %q", opts.Model, opts.Effort)
	}

	// Running: refused, nothing changes.
	if err := b.Send(s.ID, "long"); err != nil {
		t.Fatal(err)
	}
	if err := b.SetModel(s.ID, "m3", "low"); !errors.Is(err, workbench.ErrTurnRunning) {
		t.Errorf("while running: %v", err)
	}
	sc.endTurn()
	b.idle(t, s.ID)
	if got, _ := b.Session(s.ID); got.Model != "m2" {
		t.Errorf("a refused change stuck: %q", got.Model)
	}
	b.Close()

	// After a restart: kept, and the native session resumes on it.
	sc2 := newScript()
	b2 := open(t, dir, sc2.respond)
	defer b2.Close()
	if got, _ := b2.Session(s.ID); got.Model != "m2" || got.Effort != "high" {
		t.Errorf("after restart: %q %q", got.Model, got.Effort)
	}
	if st := b2.Status(s.ID); st.Model != "" {
		t.Errorf("reported before the Agent said anything: %q", st.Model)
	}
	// Not connected: kept for when it starts; back to the Agent's own.
	if err := b2.SetModel(s.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	converse(t, b2, sc2, s.ID, "resumed")
	st := b2.fake.Starts()
	if len(st) != 1 || st[0].ResumeID == "" || st[0].Model != "" || st[0].Effort != "" {
		t.Errorf("resumed with %+v", st)
	}
	if got := b2.Status(s.ID); got.Model != fake.DefaultModel {
		t.Errorf("reported %q", got.Model)
	}
	if err := b2.SetModel("nope", "m", ""); !errors.Is(err, workbench.ErrNoSuchSession) {
		t.Errorf("no such session: %v", err)
	}
}
