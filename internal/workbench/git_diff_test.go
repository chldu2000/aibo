package workbench_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/workbench"
)

func TestReadSelectedChangeDiff(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	root := t.TempDir()
	ws, _ := b.AddWorkspace(root)
	gitRun(t, root, "init", "-q")
	name := "文件 [a].txt"
	gitFile(t, root, name, "A\n")
	gitRun(t, root, "add", ".")
	read := func(group workbench.GitGroup, code, path, original string) workbench.ChangeDiff {
		t.Helper()
		d, err := b.ReadChangeDiff(context.Background(), ws.ID, workbench.GitChange{Group: group, Code: code, Path: path, Original: original})
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	check := func(d workbench.ChangeDiff, parts ...string) {
		t.Helper()
		for _, s := range parts {
			if !strings.Contains(d.Patch, s) {
				t.Fatalf("missing %q: %+v", s, d)
			}
		}
	}
	check(read(workbench.GitStaged, "A", name, ""), "new file mode", "+A")
	gitRun(t, root, "commit", "-qm", "base")
	gitFile(t, root, name, "B\n")
	gitRun(t, root, "add", "-u")
	gitFile(t, root, name, "C\n")
	check(read(workbench.GitStaged, "M", name, ""), "-A", "+B")
	check(read(workbench.GitUnstaged, "M", name, ""), "-B", "+C")
	gitRun(t, root, "commit", "-qm", "B")
	gitRun(t, root, "mv", "--", name, "renamed")
	gitRun(t, root, "add", "-u")
	// Stage an exact rename, then edit the destination only in the working tree.
	gitFile(t, root, "renamed", "B\n")
	gitRun(t, root, "add", "-u")
	gitFile(t, root, "renamed", "after\n")
	check(read(workbench.GitStaged, "R", "renamed", name), "rename from", "rename to")
	check(read(workbench.GitUnstaged, "M", "renamed", ""), "-B", "+after")
	if !read(workbench.GitUnstaged, "M", name, "").Missing {
		t.Fatal("stale selection")
	}
	gitFile(t, root, "new.txt", "hello")
	if d := read(workbench.GitUntracked, "?", "new.txt", ""); !d.Untracked || d.AddedText != "hello" {
		t.Fatal(d)
	}
	if err := os.Remove(filepath.Join(root, "renamed")); err != nil {
		t.Fatal(err)
	}
	check(read(workbench.GitUnstaged, "D", "renamed", ""), "deleted file mode", "-B")
}
