package contract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	registry "github.com/chldu2000/aibo/internal/agents"
)

// The ACP Agents' calls that change files tell each file by its texts,
// which make its patch (.scratch/ui-polish/research/23-file-changes.md):
// a file modified, with its hunk; with the Cursor CLI, one created.
// OpenCode tells no diff of a file it creates. OpenCode runs with the
// user's own configuration, which holds its sign-in and its model.
func TestContractACPFileChanges(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run OpenCode and the Cursor CLI")
	}
	const ask = "Using your file editing tools only (no shell commands): in a.txt replace the line 'two' with 'TWO'; then create b.txt with the two lines 'hello' and 'world'. Then reply DONE."
	run := func(t *testing.T, as []agent.Agent, kind agent.Kind) map[string]agent.FileChange {
		t.Helper()
		ws := t.TempDir()
		os.WriteFile(filepath.Join(ws, "a.txt"), []byte("one\ntwo\nthree\n"), 0o644)
		// Closed before the workspace is removed: on Windows, the Agent's
		// process holds it.
		e := openEnv(t, t.TempDir(), as)
		defer e.Close()
		w, _ := e.AddWorkspace(ws)
		s, err := e.NewSession(w.ID, kind, "")
		if err != nil {
			t.Fatal(err)
		}
		e.run(s.ID, ask, agent.AllowOnce)
		ms, _ := e.Messages(s.ID)
		got := map[string]agent.FileChange{}
		for _, m := range ms {
			if m.Tool != nil {
				for _, ch := range m.Tool.Changes {
					got[filepath.Base(ch.Path)] = ch
				}
			}
		}
		t.Logf("changes: %+v", got)
		if a := got["a.txt"]; a.Kind != agent.FileModified || !strings.Contains(a.Patch, "\n-two\n+TWO\n") {
			t.Errorf("a.txt changed %+v", a)
		}
		return got
	}
	t.Run("opencode", func(t *testing.T) {
		r := registry.New(registry.Options{})
		r.Check(t.Context(), registry.OpenCode)
		if st := r.Status(registry.OpenCode); !st.Usable() {
			t.Skipf("OpenCode unavailable: %+v", st)
		}
		if b, ok := run(t, r.Agents(), registry.OpenCode)["b.txt"]; ok {
			t.Logf("OpenCode now tells a file it creates: %+v", b)
		}
	})
	t.Run("cursor", func(t *testing.T) {
		r, _, _ := cursor(t)
		if b := run(t, r.Agents(), registry.Cursor)["b.txt"]; b.Kind != agent.FileAdded || !strings.Contains(b.Patch, "+hello\n+world") {
			t.Errorf("b.txt changed %+v", b)
		}
	})
}
