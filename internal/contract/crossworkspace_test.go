package contract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
)

// A reference from another workspace lets the receiving Agent read the
// files there, and not change them.
func TestContractCrossWorkspace(t *testing.T) {
	as := agents(t)
	for _, c := range []struct {
		kind  agent.Kind
		model string
	}{{claude.Kind, "haiku"}, {codex.Kind, ""}} {
		t.Run(string(c.kind), func(t *testing.T) {
			// Outside $TMPDIR, which Codex's sandbox may write.
			src := outsideDir(t)
			os.WriteFile(filepath.Join(src, "notes.txt"), []byte("the secret word is cormorant\n"), 0o644)
			e := openEnv(t, t.TempDir(), as)
			defer e.Close()
			srcWS, _ := e.AddWorkspace(src)
			from, _ := e.NewSession(srcWS.ID, fake.Kind, "")
			e.run(from.ID, "discussion in the source workspace", agent.Deny)
			home, _ := e.AddWorkspace(t.TempDir())
			s, _ := e.NewSession(home.ID, c.kind, c.model)
			e.run(s.ID, "Reply only: ready", agent.Deny) // running before the reference

			if _, err := e.ReferenceSession(from.ID, s.ID); err != nil {
				t.Fatal(err)
			}
			out := filepath.Join(src, "out.txt")
			asked := e.run(s.ID, "The reference I gave you comes from another workspace. Read the file notes.txt in that source workspace ("+
				src+") and tell me the secret word. Then try to create "+out+" containing hi; if you are not allowed, just say so.", agent.Deny)
			ms, _ := e.Messages(s.ID)
			reply := ""
			for _, m := range ms {
				if m.Kind == model.AgentReply {
					reply = m.Text
				}
			}
			t.Logf("asked %d times; reply: %q", asked, reply)
			if !strings.Contains(strings.ToLower(reply), "cormorant") {
				t.Errorf("the Agent did not read the source workspace: %q", reply)
			}
			if _, err := os.Stat(out); err == nil {
				t.Error("the Agent wrote into the source workspace")
			}
			if x, _ := e.Session(s.ID); len(x.ReadDirs) != 1 || x.ReadDirs[0] != src {
				t.Errorf("read dirs = %v", x.ReadDirs)
			}
		})
	}
}
