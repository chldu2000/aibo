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
	if name != "claude" && name != "codex" && name != "node" {
		return
	}
	b, err := os.ReadFile(os.Args[0] + ".status")
	if err != nil {
		os.Exit(2)
	}
	version, login, _ := strings.Cut(string(b), " ")
	args := os.Args[1:]
	if name == "node" { // the Cursor CLI on Windows: node.exe index.js …
		if len(args) == 0 || filepath.Base(args[0]) != "index.js" {
			os.Exit(2)
		}
		args = args[1:]
	}
	switch strings.Join(args, " ") {
	case "--version":
		fmt.Println(version)
	case "auth status":
		fmt.Printf(`{"loggedIn":%s,"authMethod":"claude.ai","subscriptionType":"pro"}`, login)
	case "status --format json": // the Cursor CLI
		if login == "true" {
			fmt.Println(`{"status":"authenticated","isAuthenticated":true,"hasAccessToken":true,"hasRefreshToken":true,"userInfo":{"email":"someone@example.com"}}`)
		} else {
			fmt.Println(`{"status":"unauthenticated","isAuthenticated":false,"hasAccessToken":false,"hasRefreshToken":false,"message":"Not logged in"}`)
		}
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
