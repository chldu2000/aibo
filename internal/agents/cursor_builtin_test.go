package agents_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/agents/testdata/fakecli"
)

// fakeCursor lays out a Cursor CLI install on Windows whose node.exe is a
// fake CLI of the given version; it returns the install and its node.exe.
func fakeCursor(t *testing.T, version string) (string, string) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "versions", version+"-e9042b2")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{filepath.Join(root, "cursor-agent.cmd"), filepath.Join(dir, "index.js")} {
		if err := os.WriteFile(p, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root, fakecli.Install(t, dir, "node", version+"-e9042b2", true)
}

// The Cursor CLI comes with aibo, as OpenCode does: found through its
// launcher, version checked, removable and restorable.
func TestCursorBuiltin(t *testing.T) {
	d, ok := agents.Describe(agents.Cursor)
	if !ok || d.Command != "cursor-agent" || d.MinVersion == "" || d.InstallURL == "" {
		t.Fatalf("Cursor = %+v", d)
	}
	if !slices.Contains(agents.BuiltinACP(), agents.Cursor) {
		t.Error("Cursor is not a built-in ACP Agent")
	}
	dir := t.TempDir()
	r, err := agents.Open(dir, agents.Options{Shell: shellWith(t), Dirs: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	cfg, ok := r.ACPConfig(agents.Cursor)
	if !ok || cfg.Command != "cursor-agent" || !slices.Equal(cfg.Args, []string{"acp"}) || cfg.Modes != nil {
		t.Fatalf("configuration = %+v", cfg)
	}
	exe, _ := os.Executable()
	if _, err := r.AddACP(agents.ACPConfig{ID: agents.Cursor, Name: "Mine", Command: exe}); !errors.Is(err, agents.ErrIDInUse) {
		t.Errorf("adding over the built-in Cursor: %v", err)
	}
	if err := r.RemoveACP(agents.Cursor); err != nil {
		t.Fatal(err)
	}
	r, _ = agents.Open(dir, agents.Options{Shell: shellWith(t), Dirs: []string{}})
	if _, ok := r.ACPConfig(agents.Cursor); ok {
		t.Fatal("the removed Cursor came back after a restart")
	}
	if _, err := r.RestoreACP(agents.Cursor); err != nil {
		t.Fatal(err)
	}
	if _, err := r.RestoreACP("other"); !errors.Is(err, agents.ErrInvalidID) {
		t.Errorf("restoring what is not built in: %v", err)
	}
	r, _ = agents.Open(dir, agents.Options{Shell: shellWith(t), Dirs: []string{}})
	if got, ok := r.ACPConfig(agents.Cursor); !ok || got.Command != "cursor-agent" {
		t.Fatalf("restored configuration = %+v", got)
	}
}

func TestCursorModeLabels(t *testing.T) {
	tags := agents.ModeTagsOf(agents.ACPConfig{ID: agents.Cursor})
	if a := tags["agent"]; a.Risk != agent.Caution || a.ReadOnly || !a.Default {
		t.Errorf("agent = %+v", a)
	}
	for _, id := range []string{"plan", "ask"} {
		if m := tags[id]; m.Risk != agent.Safe || !m.ReadOnly || m.Default {
			t.Errorf("%s = %+v", id, m)
		}
	}
	if own := agents.ModeTagsOf(agents.ACPConfig{ID: agents.Cursor, Modes: map[string]agents.ModeConfig{"agent": {Risk: "danger"}}}); len(own) != 1 || own["agent"].Risk != agent.Danger {
		t.Errorf("own labels = %+v", own)
	}
}

func TestCursorDetected(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the launcher is Windows only")
	}
	root, node := fakeCursor(t, "2026.11.22")
	r := agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{root}})
	r.Check(context.Background(), agents.Cursor)
	st := r.Status(agents.Cursor)
	if st.State != agents.Ready || st.Version != "2026.11.22" || st.Path != node || len(st.Args) != 1 || filepath.Base(st.Args[0]) != "index.js" {
		t.Fatalf("status = %+v", st)
	}
	// From PATH, as the installer leaves it.
	r = agents.New(agents.Options{Shell: shellWith(t, root), Dirs: []string{}})
	r.Check(context.Background(), agents.Cursor)
	if st := r.Status(agents.Cursor); st.State != agents.Ready || st.Source != agents.SourcePath {
		t.Errorf("from PATH: %+v", st)
	}
	// Its launcher written as the command, in the settings.
	dir := t.TempDir()
	r, _ = agents.Open(dir, agents.Options{Shell: shellWith(t), Dirs: []string{}})
	cfg, _ := r.ACPConfig(agents.Cursor)
	cfg.Command = filepath.Join(root, "cursor-agent.cmd")
	if _, err := r.EditACP(cfg); err != nil {
		t.Fatal(err)
	}
	r.Check(context.Background(), agents.Cursor)
	if st := r.Status(agents.Cursor); st.State != agents.Ready || st.Path != node || st.MinVersion == "" {
		t.Errorf("chosen launcher: %+v", st)
	}
	old, _ := fakeCursor(t, "2026.9.18")
	r = agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{old}})
	r.Check(context.Background(), agents.Cursor)
	if st := r.Status(agents.Cursor); st.State != agents.TooOld {
		t.Errorf("an older Cursor: %+v", st)
	}
}
