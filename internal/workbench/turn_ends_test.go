package workbench_test

import (
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/model"
)

// A turn's end keeps how long it took and whether it was stopped, after
// its last message and across a restart; it is not one of the markers.
func TestTurnEnds(t *testing.T) {
	var mu sync.Mutex
	at := time.Unix(1_000_000, 0)
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return at
	}
	pass := func(d time.Duration) {
		mu.Lock()
		at = at.Add(d)
		mu.Unlock()
	}
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond, now)
	_, s := newSession(t, b)

	if err := b.Send(s.ID, "hi"); err != nil {
		t.Fatal(err)
	}
	pass(65 * time.Second)
	sc.endTurn()
	b.idle(t, s.ID)
	if err := b.Send(s.ID, "again"); err != nil {
		t.Fatal(err)
	}
	pass(3 * time.Second)
	b.Stop(s.ID)
	b.idle(t, s.ID)

	check := func(when string, ends []model.Marker) {
		t.Helper()
		if len(ends) != 2 {
			t.Fatalf("%s: turn ends = %+v", when, ends)
		}
		if e := ends[0]; e.Kind != model.TurnEnded || e.AfterSeq != 1 || e.Took != 65*time.Second || e.Stopped {
			t.Errorf("%s: the first turn's end = %+v", when, e)
		}
		if e := ends[1]; e.AfterSeq != 2 || e.Took != 3*time.Second || !e.Stopped {
			t.Errorf("%s: the stopped turn's end = %+v", when, e)
		}
	}
	check("running", b.TurnEnds(s.ID))
	if ms := b.Markers(s.ID); len(ms) != 0 {
		t.Errorf("markers = %+v", ms)
	}
	b.Close()

	b = open(t, dir, newScript().respond, now)
	defer b.Close()
	check("reopened", b.TurnEnds(s.ID))
}
