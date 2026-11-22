package agents_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agents"
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

// fakeClaude answers --version and auth status as Claude Code 2.1.318
// does.
func fakeClaude(t *testing.T, dir, version string, loggedIn bool) string {
	auth := `echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}'; exit 0`
	if !loggedIn {
		auth = `echo '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'; exit 1`
	}
	return script(t, dir, "claude", `case "$1" in
--version) echo "`+version+` (Claude Code)";;
auth) `+auth+`;;
esac
`)
}

// fakeCodex answers --version and login status as codex-cli 0.169.0 does.
func fakeCodex(t *testing.T, dir, version string, loggedIn bool) string {
	login := `echo "Logged in using ChatGPT"; exit 0`
	if !loggedIn {
		login = `echo "Not logged in"; exit 1`
	}
	return script(t, dir, "codex", `case "$1" in
--version) echo "codex-cli `+version+`";;
login) `+login+`;;
esac
`)
}

// shellWith is a login shell whose PATH has dirs, after the noise rc
// files print.
func shellWith(t *testing.T, dirs ...string) string {
	return script(t, t.TempDir(), "fakesh", `echo "Welcome to my shell!"
printf '__AIBO_PATH__%s__AIBO_PATH__' "`+strings.Join(dirs, ":")+`"
echo "bye"
`)
}

func TestFoundThroughTheLoginShell(t *testing.T) {
	bin := t.TempDir()
	fakeClaude(t, bin, "2.1.320", true)
	fakeCodex(t, bin, "0.168.0", true)
	r := agents.New(agents.Options{Shell: shellWith(t, "/nowhere", bin), Dirs: []string{}})
	r.Detect(context.Background())

	c := r.Status(claude.Kind)
	if c.State != agents.Ready || c.Source != "登录 shell 的 PATH" || c.Version != "2.1.320" || c.Auth != "claude.ai（pro）" || !strings.HasPrefix(c.Path, "/") {
		t.Errorf("claude = %+v", c)
	}
	x := r.Status(codex.Kind)
	if x.State != agents.TooOld || !strings.Contains(x.Reason, "版本 0.168.0 过低，请升级到 0.169.0 或更高版本") || x.Usable() {
		t.Errorf("codex = %+v", x)
	}
	if err := r.Ready(codex.Kind); err == nil {
		t.Error("an old Codex is ready")
	}
}

func TestFixedPlacesAndChosenPaths(t *testing.T) {
	fixed, other := t.TempDir(), t.TempDir()
	fakeClaude(t, fixed, "2.1.318", true)
	chosen := fakeCodex(t, other, "0.170.1", true)
	r := agents.New(agents.Options{Shell: shellWith(t), Dirs: []string{fixed}, Paths: nil})
	r.SetPath(context.Background(), codex.Kind, chosen)
	r.Check(context.Background(), claude.Kind)
	if c := r.Status(claude.Kind); c.State != agents.Ready || c.Source != "常见安装位置" {
		t.Errorf("claude = %+v", c)
	}
	if x := r.Status(codex.Kind); x.State != agents.Ready || x.Source != "设置中指定" || x.Auth != "ChatGPT" {
		t.Errorf("codex = %+v", x)
	}
	r.SetPath(context.Background(), codex.Kind, filepath.Join(other, "gone"))
	if x := r.Status(codex.Kind); x.State != agents.NotInstalled || !strings.Contains(x.Reason, "指定的可执行文件不存在") {
		t.Errorf("a chosen path that is gone: %+v", x)
	}
	if got := r.Paths(); got[codex.Kind] != filepath.Join(other, "gone") {
		t.Errorf("paths = %v", got)
	}
}

func TestNotInstalledAndSignedOut(t *testing.T) {
	bin := t.TempDir()
	fakeClaude(t, bin, "2.1.318", false)
	fakeCodex(t, bin, "0.169.0", false)
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
	if c := none.Status(claude.Kind); c.State != agents.NotInstalled || !strings.Contains(c.Reason, "没有找到 Claude Code") {
		t.Errorf("nothing installed: %+v", c)
	}
}

func TestMarkNotLoggedIn(t *testing.T) {
	bin := t.TempDir()
	fakeClaude(t, bin, "2.1.318", true)
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
