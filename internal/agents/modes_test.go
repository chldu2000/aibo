package agents_test

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
)

func TestModeLabelsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	r, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	modes := map[string]agents.ModeConfig{"bypassPermissions": {Risk: "danger"}, "ask": {Default: true}}
	if _, err := r.AddACP(agents.ACPConfig{ID: "labelled", Name: "Labelled", Command: exe, Modes: modes}); err != nil {
		t.Fatal(err)
	}
	r, err = agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := r.ACPConfig("labelled")
	if len(got.Modes) != 2 || got.Modes["bypassPermissions"].Risk != "danger" || !got.Modes["ask"].Default {
		t.Fatalf("after a restart, modes = %+v", got.Modes)
	}
	// What ACPConfig hands out is a copy.
	got.Modes["ask"] = agents.ModeConfig{}
	if again, _ := r.ACPConfig("labelled"); !again.Modes["ask"].Default {
		t.Error("the registry's modes changed through a copy")
	}
	// Labels changed on disk since are a changed configuration.
	path := filepath.Join(dir, "agents.json")
	command, _ := json.Marshal(exe)
	data := []byte(`[{"id":"labelled","name":"Labelled","command":` + string(command) + `,"modes":{"ask":{"default":true}}}]`)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.EditACP(got); !errors.Is(err, agents.ErrConfigChanged) {
		t.Errorf("editing over changed labels: %v", err)
	}
}

func TestInvalidModeLabels(t *testing.T) {
	exe, _ := os.Executable()
	for want, modes := range map[error]map[string]agents.ModeConfig{
		agents.ErrInvalidRisk:   {"x": {Risk: "high"}},
		agents.ErrManyDefaults:  {"x": {Default: true}, "y": {Default: true}},
		agents.ErrEmptyModeName: {"": {Risk: "safe"}},
	} {
		r, err := agents.Open(t.TempDir(), agents.Options{})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := r.AddACP(agents.ACPConfig{ID: "bad", Name: "Bad", Command: exe, Modes: modes}); !errors.Is(err, want) {
			t.Errorf("%v: got %v", modes, err)
		}
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "agents.json"), []byte(`[{"id":"bad","name":"Bad","command":"bad","modes":{"x":{"risk":"high"}}}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := agents.Open(dir, agents.Options{}); !errors.Is(err, agents.ErrInvalidRisk) {
		t.Errorf("reading an invalid risk: %v", err)
	}
}

// OpenCode's modes carry built-in labels until its configuration labels
// some itself; a label without a risk is Caution.
func TestOpenCodeModeLabels(t *testing.T) {
	builtin := agents.ModeTagsOf(agents.ACPConfig{ID: agents.OpenCode})
	if p := builtin["plan"]; p.Risk != agent.Safe || !p.ReadOnly || p.Default {
		t.Errorf("plan = %+v", p)
	}
	if b := builtin["build"]; b.Risk != agent.Caution || b.ReadOnly || !b.Default {
		t.Errorf("build = %+v", b)
	}
	own := agents.ModeTagsOf(agents.ACPConfig{ID: agents.OpenCode, Modes: map[string]agents.ModeConfig{"reviewer": {ReadOnly: true, Default: true}}})
	if x := own["reviewer"]; x.Risk != agent.Caution || !x.ReadOnly || !x.Default || len(own) != 1 {
		t.Errorf("own labels = %+v", own)
	}
	if other := agents.ModeTagsOf(agents.ACPConfig{ID: "other"}); len(other) != 0 {
		t.Errorf("another Agent has labels %+v", other)
	}
	// Danger is what asks again before switching (approvals_test.go).
	if x := agents.ModeTagsOf(agents.ACPConfig{ID: "other", Modes: map[string]agents.ModeConfig{"bypassPermissions": {Risk: "danger"}}}); x["bypassPermissions"].Risk != agent.Danger {
		t.Errorf("danger = %+v", x)
	}
}
