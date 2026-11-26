package contract

import (
	"os"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	registry "github.com/chldu2000/aibo/internal/agents"
)

// Switch the model, reasoning effort and mode of the installed OpenCode
// without sending a prompt, and resume the session in a new process.
// AIBO_OPENCODE_EFFORT_MODEL names a model that takes efforts low and
// high; the default is one of OpenCode's free models in 2.4.2.
func TestContractOpenCodeSettings(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run OpenCode")
	}
	for _, key := range []string{"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"} {
		t.Setenv(key, t.TempDir())
	}
	t.Setenv("OPENCODE_DISABLE_AUTOUPDATE", "1")
	m := os.Getenv("AIBO_OPENCODE_EFFORT_MODEL")
	if m == "" {
		m = "opencode/deepseek-v4.1-flash-free"
	}
	r := registry.New(registry.Options{})
	if p := os.Getenv("AIBO_OPENCODE"); p != "" {
		r.SetPath(t.Context(), registry.OpenCode, p)
	} else {
		r.Detect(t.Context())
	}
	st := r.Status(registry.OpenCode)
	if !st.Usable() {
		t.Fatalf("OpenCode unavailable: %+v", st)
	}
	var a agent.Agent
	for _, x := range r.Agents() {
		if x.Kind() == registry.OpenCode {
			a = x
		}
	}
	ws := t.TempDir()
	// settled reads the reports until the session is quiet, and returns
	// the last of each.
	settled := func(s agent.Session) (native string, set agent.SettingsReported, mode string) {
		for {
			select {
			case ev := <-s.Events():
				switch e := ev.(type) {
				case agent.NativeSessionStarted:
					native = e.ID
				case agent.SettingsReported:
					set = e
				case agent.ModeReported:
					mode = e.ID
				}
			case <-time.After(2 * time.Second):
				return
			}
		}
	}
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: ws, Model: m, Effort: "high", Mode: "plan"})
	if err != nil {
		t.Fatal(err)
	}
	native, set, mode := settled(s)
	if native == "" || set.Model != m || set.Effort != "high" || mode != "plan" {
		t.Fatalf("started with %+v in %q", set, mode)
	}
	if err := s.SetModel(t.Context(), m, "low"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMode(t.Context(), "build"); err != nil {
		t.Fatal(err)
	}
	if _, set, mode = settled(s); set.Effort != "low" || mode != "build" {
		t.Fatalf("after switching, %+v in %q", set, mode)
	}
	if err := s.SetModel(t.Context(), m, "no-such-effort"); err == nil {
		t.Error("OpenCode took an unknown effort")
	}
	s.Close()

	// Resumed in a new process, the session keeps what it was set to.
	s, err = a.Start(t.Context(), agent.StartOptions{Workspace: ws, ResumeID: native, Model: m, Effort: "low", Mode: "build"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, set, mode = settled(s); set.Model != m || set.Effort != "low" || mode != "build" {
		t.Fatalf("resumed with %+v in %q", set, mode)
	}
	t.Logf("OpenCode %s: %s, effort %s, mode %s", st.Version, set.Model, set.Effort, mode)
}
