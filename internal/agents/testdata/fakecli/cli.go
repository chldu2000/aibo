package fakecli

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Each fake executable runs this test binary with its own version and login state.
func RunIfCLI() {
	name := strings.TrimSuffix(filepath.Base(os.Args[0]), ".exe")
	if name != "claude" && name != "codex" {
		return
	}
	b, err := os.ReadFile(os.Args[0] + ".status")
	if err != nil {
		os.Exit(2)
	}
	version, login, _ := strings.Cut(string(b), " ")
	switch strings.Join(os.Args[1:], " ") {
	case "--version":
		fmt.Println(version)
	case "auth status":
		fmt.Printf(`{"loggedIn":%s,"authMethod":"claude.ai","subscriptionType":"pro"}`, login)
	case "login status":
		if login == "true" {
			fmt.Fprintln(os.Stderr, "Logged in using ChatGPT")
		} else {
			os.Exit(1)
		}
	default:
		os.Exit(2)
	}
	os.Exit(0)
}

// Install places a fake CLI with the given status in dir.
func Install(t *testing.T, dir, name, version string, loggedIn bool) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if runtime.GOOS == "windows" {
		p += ".exe"
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Link(self, p); err != nil {
		b, err := os.ReadFile(self)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, b, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(p+".status", fmt.Appendf(nil, "%s %t", version, loggedIn), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}
