package contract

import (
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/model"
)

func TestContractCompactionAndSelfReference(t *testing.T) {
	as := agents(t)
	for _, c := range []struct {
		kind  agent.Kind
		model string
	}{{claude.Kind, "haiku"}, {codex.Kind, ""}} {
		t.Run(string(c.kind), func(t *testing.T) {
			e := openEnv(t, t.TempDir(), as)
			defer e.Close()
			w, _ := e.AddWorkspace(t.TempDir())
			s, _ := e.NewSession(w.ID, c.kind, c.model)
			if n := e.run(s.ID, "The secret code is osprey-77. Reply only OK.", agent.Deny); n != 0 {
				t.Fatalf("asked %d times", n)
			}
			if err := e.Compact(s.ID); err != nil {
				t.Fatal(err)
			}
			e.until(func() bool { return !e.Status(s.ID).Running })
			if st := e.Status(s.ID); st.Error != nil {
				t.Fatalf("compacting: %s", st.Error)
			}
			ms := e.Markers(s.ID)
			if len(ms) != 1 || ms[0].Kind != model.Compaction || ms[0].Trigger != "manual" || ms[0].AfterSeq != 2 {
				t.Fatalf("markers = %+v", ms)
			}
			t.Logf("marker: %+v", ms[0])

			r, err := e.ReferenceRange(s.ID, 1, 2, s.ID)
			if err != nil {
				t.Fatal(err)
			}
			e.run(s.ID, "Use the aibo tools to read the reference I gave you and reply with only the secret code it contains.", agent.Deny)
			got, _ := e.Messages(s.ID)
			reply := ""
			for _, m := range got {
				if m.Kind == model.AgentReply {
					reply = m.Text
				}
			}
			if !strings.Contains(reply, "osprey-77") {
				t.Errorf("reply = %q", reply)
			}
			if ref, _ := e.Reference(r.ID); len(ref.Reads) == 0 {
				t.Error("the self-reference was not read")
			}
		})
	}
}
