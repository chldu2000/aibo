package agents_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/agents/testdata/fakecli"
)

// script writes an executable shell script.
func script(t *testing.T, dir, name, body string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMain(m *testing.M) {
	fakecli.RunIfCLI()
	os.Exit(m.Run())
}

// shellWith is a login shell whose PATH has dirs, after the noise rc
// files print.
func shellWith(t *testing.T, dirs ...string) string {
	if runtime.GOOS == "windows" {
		t.Setenv("PATH", strings.Join(dirs, string(os.PathListSeparator)))
		return ""
	}
	return script(t, t.TempDir(), "fakesh", `echo "Welcome to my shell!"
printf '__AIBO_PATH__%s__AIBO_PATH__' "`+strings.Join(dirs, ":")+`"
echo "bye"
`)
}

func TestFoundThroughTheLoginShell(t *testing.T) {
	bin := t.TempDir()
	fakecli.Install(t, bin, "claude", "2.1.320", true)
	fakecli.Install(t, bin, "codex", "0.168.0", true)
	r := agents.New(agents.Options{Shell: shellWith(t, "/nowhere", bin), Dirs: []string{}})
	r.Detect(context.Background())

	c := r.Status(claude.Kind)
	if c.State != agents.Ready || c.Source != agents.SourcePath || c.Version != "2.1.320" || c.Auth != "claude.ai (pro)" || !filepath.IsAbs(c.Path) {
		t.Errorf("claude = %+v", c)
	}
	x := r.Status(codex.Kind)
	if x.State != agents.TooOld || x.Problem != agents.ProblemTooOld || x.Usable() {
		t.Errorf("codex = %+v", x)
	}
	if err := r.Ready(codex.Kind); err == nil {
		t.Error("an old Codex is ready")
	}
}

func TestFixedPlacesAndChosenPaths(t *testing.T) {
	fixed, other := t.TempDir(), t.TempDir()
	fakecli.Install(t, fixed, "claude", "2.1.318", true)
	chosen := fakecli.Install(t, other, "codex", "0.170.1", true)
	r := agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{fixed}, Paths: nil})
	r.SetPath(context.Background(), codex.Kind, chosen)
	r.Check(context.Background(), claude.Kind)
	if c := r.Status(claude.Kind); c.State != agents.Ready || c.Source != agents.SourceCommon {
		t.Errorf("claude = %+v", c)
	}
	if x := r.Status(codex.Kind); x.State != agents.Ready || x.Source != agents.SourceSettings || x.Auth != "ChatGPT" {
		t.Errorf("codex = %+v", x)
	}
	r.SetPath(context.Background(), codex.Kind, filepath.Join(other, "gone"))
	if x := r.Status(codex.Kind); x.State != agents.NotInstalled || x.Problem != agents.ProblemBadPath {
		t.Errorf("a chosen path that is gone: %+v", x)
	}
	if got := r.Paths(); got[codex.Kind] != filepath.Join(other, "gone") {
		t.Errorf("paths = %v", got)
	}
}

func TestNotInstalledAndSignedOut(t *testing.T) {
	bin := t.TempDir()
	fakecli.Install(t, bin, "claude", "2.1.318", false)
	fakecli.Install(t, bin, "codex", "0.169.0", false)
	r := agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{bin}})
	r.Detect(context.Background())
	if c := r.Status(claude.Kind); c.State != agents.NotLoggedIn || !c.Usable() {
		t.Errorf("claude = %+v", c)
	}
	// Claude Code signed out still takes a message, and says so; Codex
	// does not.
	if err := r.Ready(claude.Kind); err != nil {
		t.Errorf("claude ready: %v", err)
	}
	if err := r.Ready(codex.Kind); !errors.Is(err, agents.ErrNotLoggedIn) {
		t.Errorf("codex ready: %v", err)
	}

	none := agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{t.TempDir()}})
	none.Detect(context.Background())
	if c := none.Status(claude.Kind); c.State != agents.NotInstalled || c.Problem != agents.ProblemNotFound {
		t.Errorf("nothing installed: %+v", c)
	}
}

func TestMarkNotLoggedIn(t *testing.T) {
	bin := t.TempDir()
	fakecli.Install(t, bin, "claude", "2.1.318", true)
	r := agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{bin}})
	r.Check(context.Background(), claude.Kind)
	changed := 0
	r.OnChange(func() { changed++ })
	r.MarkNotLoggedIn(claude.Kind)
	if c := r.Status(claude.Kind); c.State != agents.NotLoggedIn || changed != 1 {
		t.Errorf("after a session found it signed out: %+v (%d changes)", c, changed)
	}
}

func TestShellPathTimesOut(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows reads PATH directly")
	}
	slow := script(t, t.TempDir(), "slowsh", "sleep 30\n")
	start := time.Now()
	if _, err := agents.ShellPath(context.Background(), slow); err == nil {
		t.Error("a shell that never answers gave a PATH")
	}
	if d := time.Since(start); d > 10*time.Second {
		t.Errorf("waited %v", d)
	}
}

// Each supported Agent is described for the shell, which knows no Agent
// by name: its icon, how it signs in, whether signed out it holds a
// message. Only an in-app one signs in in aibo.
func TestDescribe(t *testing.T) {
	cl, ok1 := agents.Describe(claude.Kind)
	cx, ok2 := agents.Describe(codex.Kind)
	if !ok1 || !ok2 {
		t.Fatal("a supported Agent is not described")
	}
	if cl.Login != agents.LoginTerminal || cl.HoldsSignedOut || len(cl.Glyph) == 0 || cl.Command != "claude" {
		t.Errorf("Claude Code = %+v", cl)
	}
	if cx.Login != agents.LoginInApp || !cx.HoldsSignedOut || len(cx.Glyph) == 0 {
		t.Errorf("Codex = %+v", cx)
	}
	if _, ok := agents.Describe("fake"); ok {
		t.Error("an unsupported Agent is described")
	}
	r := agents.New(agents.Options{})
	if _, err := r.StartLogin(context.Background(), claude.Kind, false); !errors.Is(err, agents.ErrNoInAppLogin) {
		t.Errorf("signing in to Claude Code in aibo: %v", err)
	}
	if l := r.AppLogin(claude.Kind); l.Waiting || l.Error != "" {
		t.Errorf("a sign-in to Claude Code: %+v", l)
	}
}
