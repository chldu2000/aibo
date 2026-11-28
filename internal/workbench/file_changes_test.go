package workbench_test

import (
	"encoding/json"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
)

// The files a call changes, as its adapter tells them: those it announces,
// replaced by those its result tells, kept across a restart; a result that
// tells none keeps what the start told.
func TestFileChanges(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b)

	proposed := []agent.FileChange{{Path: "a.txt", Kind: agent.FileModified, Patch: agent.PatchHunks("a.txt", "@@ -1 +1 @@\n-a\n+b")}}
	made := []agent.FileChange{{Path: "a.txt", Kind: agent.FileModified, Patch: agent.PatchHunks("a.txt", "@@ -1,2 +1,2 @@\n-a\n+b\n c")},
		{Path: "b.txt", Kind: agent.FileAdded, Patch: agent.PatchAdded("b.txt", "new\n")}}
	b.Send(s.ID, "edit")
	sc.emit(
		agent.ToolStarted{ToolID: "e", Name: "apply_patch", Input: json.RawMessage(`{}`), Changes: proposed},
		agent.ToolStarted{ToolID: "w", Name: "apply_patch", Input: json.RawMessage(`{}`), Changes: proposed},
	)
	b.waitFor(t, "the calls", func() bool { return len(b.messages(t, s.ID)) == 3 })
	if got := b.messages(t, s.ID)[1].Tool.Changes; len(got) != 1 || got[0] != proposed[0] {
		t.Errorf("as it started, the call changes %+v", got)
	}
	sc.emit(
		agent.ToolFinished{ToolID: "e", Output: "ok", Changes: made},
		agent.ToolFinished{ToolID: "w", Output: "ok"},
	)
	sc.endTurn()
	b.idle(t, s.ID)

	check := func(when string, ms []model.Message) {
		t.Helper()
		if got := ms[1].Tool.Changes; len(got) != 2 || got[0] != made[0] || got[1] != made[1] {
			t.Errorf("%s: the call changed %+v", when, got)
		}
		if got := ms[2].Tool.Changes; len(got) != 1 || got[0] != proposed[0] {
			t.Errorf("%s: the call that told no result changed %+v", when, got)
		}
	}
	check("done", b.messages(t, s.ID))
	b.Close()

	b = open(t, dir, newScript().respond)
	defer b.Close()
	check("reopened", b.messages(t, s.ID))
}
