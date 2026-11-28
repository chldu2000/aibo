package contract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
)

// Each Agent's calls that change files tell each file with its patch
// (.scratch/ui-polish/research/10-file-changes.md): a file modified, with
// its hunk; one added, its text; with Codex, one deleted.
func TestContractFileChanges(t *testing.T) {
	as := agents(t)
	for _, c := range []struct {
		kind   agent.Kind
		model  string
		ask    string
		delete bool
	}{
		{claude.Kind, "haiku", "With your file tools, nothing else: use Edit to replace the line 'two' with 'TWO' in a.txt, then Write to create b.txt holding the line 'hello'. Then reply DONE.", false},
		{codex.Kind, "", "Using apply_patch only, and no other commands: in a.txt replace the line 'two' with 'TWO'; create b.txt holding the line 'hello'; delete c.txt. Then reply DONE.", true},
	} {
		t.Run(string(c.kind), func(t *testing.T) {
			ws := t.TempDir()
			os.WriteFile(filepath.Join(ws, "a.txt"), []byte("one\ntwo\nthree\n"), 0o644)
			os.WriteFile(filepath.Join(ws, "c.txt"), []byte("remove me\n"), 0o644)
			// Closed before the workspace is removed: on Windows, the
			// Agent's process holds it.
			e := openEnv(t, t.TempDir(), as)
			defer e.Close()
			w, _ := e.AddWorkspace(ws)
			s, _ := e.NewSession(w.ID, c.kind, c.model)
			e.run(s.ID, c.ask, agent.AllowOnce)
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
			if b := got["b.txt"]; b.Kind != agent.FileAdded || !strings.Contains(b.Patch, "+hello") {
				t.Errorf("b.txt changed %+v", b)
			}
			if d := got["c.txt"]; c.delete && (d.Kind != agent.FileDeleted || !strings.Contains(d.Patch, "-remove me")) {
				t.Errorf("c.txt changed %+v", d)
			}
		})
	}
}
