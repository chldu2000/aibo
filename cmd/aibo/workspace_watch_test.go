package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestIgnoreInWorkspace(t *testing.T) {
	for _, c := range []struct {
		name  string
		isDir bool
		want  bool
	}{
		{".git", true, false},
		{".git/HEAD", false, false},
		{".git/index", false, false},
		{".git/refs", true, false},
		{".git/refs/heads", true, false},
		{".git/objects", true, true},
		{".git/logs", true, true},
		{".git/hooks", true, true},
		{"sub/.git/objects", true, true},
		{"sub/.git/refs", true, false},
		{"src", true, false},
		{"src/objects", true, false},
		{"node_modules", true, false},
	} {
		if got := ignoreInWorkspace(c.name, c.isDir); got != c.want {
			t.Errorf("ignoreInWorkspace(%q, %v) = %v, want %v", c.name, c.isDir, got, c.want)
		}
	}
}

// Making a repository, and committing in it, tells the watch: the Git
// page reads them again.
func TestWatchSeesGit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	changes := make(chan struct{}, 64)
	go watchWorkspace(ctx, dir, func() {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	wait := func(what string) {
		t.Helper()
		select {
		case <-changes:
		case <-time.After(5 * time.Second):
			t.Fatalf("no change after %s", what)
		}
	}
	quiet := func() {
		for {
			select {
			case <-changes:
			case <-time.After(400 * time.Millisecond):
				return
			}
		}
	}
	wait("the watch started")
	quiet()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid"}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatal(err, string(out))
		}
	}
	git("init", "-b", "main")
	wait("git init")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git("add", "a.txt")
	quiet()
	git("commit", "-m", "first")
	wait("git commit")
}
