package agents

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
)

// cursorInstall lays out a Cursor CLI install on Windows: the launchers,
// and the given version directories, each with node.exe and index.js
// unless its name ends in "!" (then it has no index.js).
func cursorInstall(t *testing.T, versions ...string) string {
	t.Helper()
	root := t.TempDir()
	write := func(p string) {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"cursor-agent.cmd", "cursor-agent.ps1", "agent.cmd", "agent.ps1"} {
		write(filepath.Join(root, name))
	}
	for _, v := range versions {
		broken := v[len(v)-1] == '!'
		if broken {
			v = v[:len(v)-1]
		}
		write(filepath.Join(root, "versions", v, "node.exe"))
		if !broken {
			write(filepath.Join(root, "versions", v, "index.js"))
		}
	}
	return root
}

func TestCursorLauncher(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the launcher is Windows only")
	}
	node := func(root, v string) (string, []string) {
		d := filepath.Join(root, "versions", v)
		return filepath.Join(d, "node.exe"), []string{filepath.Join(d, "index.js")}
	}
	for name, c := range map[string]struct {
		versions []string
		want     string // "" when none
	}{
		"newest by date":          {[]string{"2026.9.18-9a7762b", "2026.11.22-e9042b2", "2026.10.22-27dcf5f"}, "2026.11.22-e9042b2"},
		"staged and previous":     {[]string{"2026.11.22-e9042b2.new", "2026.10.22-27dcf5f", "2026.11.22-e9042b2.previous"}, "2026.10.22-27dcf5f"},
		"stamped after the day's": {[]string{"2026.11.22-e9042b2", "2026.11.22-09-30-00-abc1234"}, "2026.11.22-09-30-00-abc1234"},
		"incomplete skipped":      {[]string{"2026.11.22-e9042b2!", "2026.10.22-27dcf5f"}, "2026.10.22-27dcf5f"},
		"no version":              {nil, ""},
		"not a version":           {[]string{"latest"}, ""},
	} {
		t.Run(name, func(t *testing.T) {
			root := cursorInstall(t, c.versions...)
			exe, pre, ok := cursorLauncher(root)
			if c.want == "" {
				if ok {
					t.Fatalf("found %s %q", exe, pre)
				}
				return
			}
			wantExe, wantPre := node(root, c.want)
			if !ok || exe != wantExe || !slices.Equal(pre, wantPre) {
				t.Fatalf("got %s %q %v, want %s %q", exe, pre, ok, wantExe, wantPre)
			}
			// Found in a directory to search, as from PATH.
			if p, a, ok := findIn(cursorCommand, []string{t.TempDir(), root}); !ok || p != wantExe || !slices.Equal(a, wantPre) {
				t.Errorf("findIn: %s %q %v", p, a, ok)
			}
			// Chosen in the settings: either launcher, or the node.exe.
			for _, chosen := range []string{filepath.Join(root, "cursor-agent.cmd"), filepath.Join(root, "agent.ps1"), wantExe} {
				if p, a, ok := cursorChosen(chosen); !ok || p != wantExe || !slices.Equal(a, wantPre) {
					t.Errorf("chose %s: %s %q %v", chosen, p, a, ok)
				}
			}
		})
	}
	// Launchers without the install beside them are not the Cursor CLI.
	alone := t.TempDir()
	if err := os.WriteFile(filepath.Join(alone, "cursor-agent.cmd"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := cursorChosen(filepath.Join(alone, "cursor-agent.cmd")); ok {
		t.Error("a lone launcher was taken")
	}
	if _, _, ok := findIn("codex", []string{cursorInstall(t, "2026.11.22-e9042b2")}); ok {
		t.Error("another Agent was found in the Cursor CLI's install")
	}
}

func TestCursorVersion(t *testing.T) {
	v := versionRE.FindString("2026.11.22-e9042b2\n")
	if v != "2026.11.22" {
		t.Fatalf("version %q", v)
	}
	if older(v, "2026.11.22") || !older("2026.9.18", v) || older("2027.1.2", v) {
		t.Error("versions by date compare wrong")
	}
}
