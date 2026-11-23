package contract

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	registry "github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/workbench"
)

// Signed out, as the real Agents are with empty config directories of
// their own: the user's sign-ins are not touched.
func TestContractSignedOut(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run against the real Agents")
	}
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	t.Setenv("CODEX_HOME", t.TempDir())
	t.Setenv("ANTHROPIC_API_KEY", "")
	r := registry.New(registry.Options{})
	r.Detect(context.Background())
	for _, s := range r.Statuses() {
		t.Logf("%s: state %d problem %d %s", s.Name, s.State, s.Problem, s.Detail)
		if s.State != registry.NotLoggedIn {
			t.Errorf("%s is not signed out: %+v", s.Name, s)
		}
	}

	signedOut := make(chan agent.Kind, 4)
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: r.Agents(), OnNotLoggedIn: func(k agent.Kind) { signedOut <- k }})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	ws, _ := w.AddWorkspace(t.TempDir())
	for _, kind := range []agent.Kind{claude.Kind, codex.Kind} {
		s, _ := w.NewSession(ws.ID, kind, "")
		start := time.Now()
		if err := w.Send(s.ID, "Reply OK."); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		select {
		case k := <-signedOut:
			t.Logf("%s found signed out after %v", k, time.Since(start).Round(time.Millisecond))
		case <-time.After(time.Minute):
			t.Fatalf("%s never said it was signed out", kind)
		}
		for w.Status(s.ID).Running {
			time.Sleep(50 * time.Millisecond)
		}
		st := w.Status(s.ID)
		ms, _ := w.Messages(s.ID)
		if !st.NeedsLogin || len(ms) != 1 {
			t.Errorf("%s: status %+v, %d messages", kind, st, len(ms))
		}
	}
	// With the registry's gate, Codex is not even sent to.
	if err := r.Ready(codex.Kind); err == nil {
		t.Error("a signed-out Codex is ready")
	}
}
