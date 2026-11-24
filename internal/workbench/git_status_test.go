package workbench_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/workbench"
)

func gitRun(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v %s", args, err, out)
	}
}
func gitFile(t *testing.T, root, name, data string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
}
func TestWorkspaceGitStatus(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.Mkdir(sub, 0700); err != nil {
		t.Fatal(err)
	}
	ws, err := b.AddWorkspace(sub)
	if err != nil {
		t.Fatal(err)
	}
	status := func() workbench.RepositoryStatus {
		t.Helper()
		r, err := b.RepositoryStatus(context.Background(), ws.ID)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	if _, err := b.RepositoryStatus(context.Background(), ws.ID); !errors.Is(err, workbench.ErrNotRepository) {
		t.Fatalf("plain: %v", err)
	}
	gitRun(t, root, "init", "-b", "main")
	if r := status(); r.Branch != "main" || r.OID != "(initial)" {
		t.Fatalf("unborn: %+v", r)
	}
	name := "文件 [1].txt"
	gitFile(t, sub, name, "A\n")
	gitFile(t, sub, "old", "rename\n")
	gitRun(t, root, "add", ".")
	gitRun(t, root, "commit", "-qm", "base")
	gitRun(t, root, "checkout", "--detach", "-q")
	if r := status(); len(r.Changes) != 0 || r.Branch != "(detached)" {
		t.Fatalf("clean: %+v", r)
	}
	gitFile(t, sub, name, "B\n")
	gitRun(t, root, "add", "-u")
	gitFile(t, sub, name, "C\n")
	gitRun(t, sub, "mv", "old", "新 名")
	gitFile(t, sub, "extra", "new")
	gitFile(t, root, "outside", "no")
	changes := status().Changes
	want := []workbench.GitChange{{Group: workbench.GitStaged, Code: "M", Path: name}, {Group: workbench.GitUnstaged, Code: "M", Path: name}, {Group: workbench.GitStaged, Code: "R", Path: "新 名", Original: "old"}, {Group: workbench.GitUntracked, Code: "?", Path: "extra"}}
	if len(changes) != len(want) {
		t.Fatalf("changes: %+v", changes)
	}
	for _, v := range want {
		if !slices.Contains(changes, v) {
			t.Fatalf("missing %+v in %+v", v, changes)
		}
	}
	gitRun(t, root, "checkout", "-f", "main")
	gitRun(t, root, "checkout", "-qb", "side")
	gitFile(t, sub, name, "side\n")
	gitRun(t, root, "commit", "-qam", "side")
	gitRun(t, root, "checkout", "-q", "main")
	gitFile(t, sub, name, "main\n")
	gitRun(t, root, "commit", "-qam", "main")
	if err := exec.Command("git", "-C", root, "merge", "--no-commit", "side").Run(); err == nil {
		t.Fatal("expected conflict")
	}
	if !slices.Contains(status().Changes, workbench.GitChange{Group: workbench.GitConflict, Code: "UU", Path: name}) {
		t.Fatal(status())
	}
	t.Setenv("PATH", t.TempDir())
	if _, err := b.RepositoryStatus(context.Background(), ws.ID); !errors.Is(err, workbench.ErrGitMissing) {
		t.Fatalf("missing git: %v", err)
	}
}
