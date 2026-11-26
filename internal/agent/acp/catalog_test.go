package acp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// fakeACP is an Agent that runs this test binary as a fake ACP Agent of
// the given kind (fakeAgent), with the requests it received and a count
// of the times it said its lists changed.
func fakeACP(t *testing.T, kind string) (*Agent, func() []string, *atomic.Int32) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(t.TempDir(), "requests")
	a := New("fake-acp", "Fake ACP", exe, nil, "")
	a.Configure(exe, []string{"AIBO_ACP_FAKE=" + kind, "AIBO_ACP_LOG=" + log})
	var changed atomic.Int32
	a.OnListsChanged(func() { changed.Add(1) })
	return a, func() []string {
		b, _ := os.ReadFile(log)
		return strings.Fields(string(b))
	}, &changed
}

func modelsText(ms []agent.Model) (out []string) {
	for _, m := range ms {
		out = append(out, m.ID+":"+m.Name+":"+strings.Join(m.Efforts, ",")+":"+m.DefaultEffort)
	}
	return out
}

func modesText(ms []agent.PermissionMode) (out []string) {
	for _, m := range ms {
		s := m.ID + ":" + m.Name
		if m.Default {
			s += ":default"
		}
		if m.Risk != agent.Caution || m.ReadOnly {
			s += ":not caution"
		}
		out = append(out, s)
	}
	return out
}

func TestProbeLists(t *testing.T) {
	a, requests, changed := fakeACP(t, "options")
	if !a.TellsModels() {
		t.Error("an Agent not probed yet tells no models")
	}
	ms, err := a.Models(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"m2:M2:low,high,default:default", "m0:M0:low,high,default:default", "m1:M1::"}
	if got := modelsText(ms); !slices.Equal(got, want) {
		t.Errorf("models\n got %q\nwant %q", got, want)
	}
	modes, err := a.PermissionModes(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if got := modesText(modes); !slices.Equal(got, []string{"build:BUILD:default", "plan:PLAN"}) {
		t.Errorf("modes %q", got)
	}
	// Every model once, then the probe session goes.
	if got := requests(); !slices.Equal(got, []string{"session/new", "model=m0", "model=m1", "session/delete"}) {
		t.Errorf("requests %q", got)
	}
	if n := changed.Load(); n != 1 {
		t.Errorf("said its lists changed %d times", n)
	}
	// Once known, the lists are not probed for again.
	a.Models(t.Context())
	if got := requests(); len(got) != 4 {
		t.Errorf("probed again: %q", got)
	}
}

// An Agent that cannot delete a probe session tells its lists once a
// session started.
func TestListsLearnedFromSessions(t *testing.T) {
	a, requests, changed := fakeACP(t, "options-nodelete")
	if _, err := a.Models(t.Context()); !errors.Is(err, agent.ErrListsUnknown) {
		t.Fatalf("before any session: %v", err)
	}
	if _, err := a.PermissionModes(t.Context()); !errors.Is(err, agent.ErrListsUnknown) {
		t.Fatalf("modes before any session: %v", err)
	}
	if got := requests(); len(got) != 0 {
		t.Fatalf("probed an Agent that cannot delete: %q", got)
	}
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if changed.Load() == 0 {
		t.Error("the first session told nothing")
	}
	ms, _ := a.Models(t.Context())
	// Only the efforts of the model the session is on are known.
	if got := modelsText(ms); !slices.Equal(got, []string{"m2:M2:low,high,default:default", "m0:M0::", "m1:M1::"}) {
		t.Errorf("models %q", got)
	}
	before := changed.Load()
	if err := s.SetModel(t.Context(), "m0", ""); err != nil {
		t.Fatal(err)
	}
	ms, _ = a.Models(t.Context())
	if got := modelsText(ms); !slices.Equal(got, []string{"m2:M2:low,high,default:default", "m0:M0:low,high,default:default", "m1:M1::"}) {
		t.Errorf("after m0, models %q", got)
	}
	if changed.Load() == before {
		t.Error("learning m0's efforts said nothing")
	}
	// What did not change says nothing.
	before = changed.Load()
	if err := s.SetMode(t.Context(), "plan"); err != nil {
		t.Fatal(err)
	}
	if changed.Load() != before {
		t.Error("a new current mode was told as a new list")
	}
	modes, _ := a.PermissionModes(t.Context())
	if got := modesText(modes); !slices.Equal(got, []string{"build:BUILD:default", "plan:PLAN"}) {
		t.Errorf("modes %q", got)
	}
}

// An Agent that cannot delete, but keeps no session without a prompt, is
// probed by starting a session alone: no model is set (the Cursor CLI
// keeps each choice for the user's own sessions), none deleted.
func TestProbeWithoutDelete(t *testing.T) {
	a, requests, changed := fakeACP(t, "options-nodelete")
	a.SetProbeWithoutDelete(true)
	ms, err := a.Models(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if got := modelsText(ms); !slices.Equal(got, []string{"m2:M2:low,high,default:default", "m0:M0::", "m1:M1::"}) {
		t.Errorf("models %q", got)
	}
	modes, _ := a.PermissionModes(t.Context())
	if got := modesText(modes); !slices.Equal(got, []string{"build:BUILD:default", "plan:PLAN"}) {
		t.Errorf("modes %q", got)
	}
	if got := requests(); !slices.Equal(got, []string{"session/new"}) {
		t.Errorf("requests %q", got)
	}
	if n := changed.Load(); n != 1 {
		t.Errorf("said its lists changed %d times", n)
	}
	// The other models' efforts come from the sessions on them.
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir(), Model: "m0"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ms, _ = a.Models(t.Context())
	if got := modelsText(ms); !slices.Equal(got, []string{"m2:M2:low,high,default:default", "m0:M0:low,high,default:default", "m1:M1::"}) {
		t.Errorf("after a session on m0, models %q", got)
	}
}

// A resumed session tells the modes, but not which is the default.
func TestResumedSessionKeepsDefault(t *testing.T) {
	a := New("x", "X", "", nil, "")
	s := &session{events: make(chan agent.Event, 8), log: agent.Discard, learn: a.learn}
	opts := func(mode string) []configOption {
		return []configOption{{ID: "mode", Category: "mode", CurrentValue: []byte(`"` + mode + `"`), Options: []byte(`[{"value":"build"},{"value":"plan"}]`)}}
	}
	s.configure(opts("plan"), nil, false)
	modes, _ := a.PermissionModes(context.Background())
	if got := modesText(modes); !slices.Equal(got, []string{"build:build", "plan:plan"}) {
		t.Errorf("after a resumed session, modes %q", got)
	}
	s.configure(opts("build"), nil, true)
	s.configure(opts("plan"), nil, false)
	modes, _ = a.PermissionModes(context.Background())
	if got := modesText(modes); !slices.Equal(got, []string{"build:build:default", "plan:plan"}) {
		t.Errorf("after a new session, modes %q", got)
	}
}

func TestLegacyAgentTellsNoModels(t *testing.T) {
	a, _, _ := fakeACP(t, "legacy")
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if a.TellsModels() {
		t.Error("an Agent without models tells them")
	}
	modes, _ := a.PermissionModes(t.Context())
	if got := modesText(modes); !slices.Equal(got, []string{"code:Code:default", "architect:Architect"}) {
		t.Errorf("modes %q", got)
	}
}

// A failed probe is tried again on the next ask.
func TestProbeFailsThenRetries(t *testing.T) {
	a, _, _ := fakeACP(t, "options")
	exe, _ := os.Executable()
	a.Configure(filepath.Join(t.TempDir(), "missing"), nil)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if _, err := a.Models(ctx); err == nil || errors.Is(err, agent.ErrListsUnknown) {
		t.Fatalf("a missing executable: %v", err)
	}
	a.Configure(exe, []string{"AIBO_ACP_FAKE=options", "AIBO_ACP_LOG=" + filepath.Join(t.TempDir(), "log")})
	if ms, err := a.Models(ctx); err != nil || len(ms) != 3 {
		t.Fatalf("after the fix: %v, %+v", err, ms)
	}
}

// A launcher's script goes before the Agent's own arguments, and pointing
// elsewhere forgets the lists another program told.
func TestConfigureCommand(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	args := filepath.Join(dir, "args")
	a := New("x", "X", "", []string{"acp"}, "")
	a.ConfigureCommand(exe, []string{"index.js"}, []string{"AIBO_ACP_FAKE=options", "AIBO_ACP_LOG=" + filepath.Join(dir, "log"), "AIBO_ACP_ARGS=" + args})
	if _, err := a.Models(t.Context()); err != nil {
		t.Fatal(err)
	}
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	if b, _ := os.ReadFile(args); string(b) != "index.js\nacp" {
		t.Errorf("ran with %q", b)
	}
	a.ConfigureCommand(exe, []string{"other.js"}, []string{"AIBO_ACP_FAKE=options-nodelete"})
	if _, err := a.Models(t.Context()); !errors.Is(err, agent.ErrListsUnknown) {
		t.Errorf("after another script, models: %v", err)
	}
}

// The configuration labels modes; one without a label is Caution. Its
// default is the mode a session with none starts in.
func TestModeTags(t *testing.T) {
	a, requests, _ := fakeACP(t, "options")
	a.SetModeTags(map[string]ModeTag{"plan": {Risk: agent.Safe, ReadOnly: true, Default: true}, "gone": {Risk: agent.Danger}})
	modes, err := a.PermissionModes(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(modes) != 2 || modes[0].ID != "build" || modes[0].Risk != agent.Caution || modes[0].ReadOnly || modes[0].Default ||
		modes[1].ID != "plan" || modes[1].Risk != agent.Safe || !modes[1].ReadOnly || !modes[1].Default {
		t.Fatalf("modes %+v", modes)
	}
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if got := reports(s); !slices.Contains(got, "mode=plan") || slices.Contains(got, "mode=build") {
		t.Errorf("a session with no mode reported %q", got)
	}
	if err := s.SetMode(t.Context(), "build"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMode(t.Context(), ""); err != nil {
		t.Fatal(err)
	}
	if got := reports(s); !slices.Equal(got[len(got)-1:], []string{"mode=plan"}) {
		t.Errorf("back to the default, reported %q", got)
	}
	got := requests()
	if !slices.Equal(got[len(got)-4:], []string{"session/new", "mode=plan", "mode=build", "mode=plan"}) {
		t.Errorf("requests %q", got)
	}
}
