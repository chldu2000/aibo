package workbench_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/workbench"
)

func TestBrowseWorkspaceFiles(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	root := t.TempDir()
	ws, err := b.AddWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	write := func(name, data string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	if err := os.Mkdir(filepath.Join(root, "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	write("零.txt", "hello")
	write("binary", "a\x00b")
	write("large", strings.Repeat("界", 200000))
	list, err := b.BrowseDirectory(ctx, ws.ID, ".")
	if err != nil || len(list.Entries) != 4 || list.Entries[0].Name != "empty" {
		t.Fatalf("plain directory: %v %v", list, err)
	}
	empty, err := b.BrowseDirectory(ctx, ws.ID, "empty")
	if err != nil || len(empty.Entries) != 0 {
		t.Fatalf("empty: %v %v", empty, err)
	}
	txt, err := b.PreviewFile(ctx, ws.ID, "零.txt")
	if err != nil || txt.Text != "hello" || txt.Truncated {
		t.Fatalf("text: %+v %v", txt, err)
	}
	if _, err := b.PreviewFile(ctx, ws.ID, "binary"); !errors.Is(err, workbench.ErrPreviewBinary) {
		t.Fatalf("binary: %v", err)
	}
	if _, err := b.PreviewFile(ctx, ws.ID, "missing"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing: %v", err)
	}
	large, err := b.PreviewFile(ctx, ws.ID, "large")
	if err != nil || !large.Truncated || len(large.Text) > 512<<10 || !strings.HasSuffix(large.Text, "界") {
		t.Fatalf("bounded UTF-8 preview: %d %v", len(large.Text), err)
	}
	for _, bad := range []string{"../outside", ".git/config", "empty/../../outside"} {
		if _, err := b.PreviewFile(ctx, ws.ID, bad); !errors.Is(err, workbench.ErrNotReadable) {
			t.Fatalf("accepted %q: %v", bad, err)
		}
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(root, "link")); err == nil {
		if _, err := b.BrowseDirectory(ctx, ws.ID, "link"); err == nil {
			t.Fatal("followed an external directory link")
		}
	}
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatal(string(out), err)
	}
	write(".gitignore", "binary\n")
	list, err = b.BrowseDirectory(ctx, ws.ID, ".")
	if err != nil || slices.ContainsFunc(list.Entries, func(e workbench.DirectoryEntry) bool { return e.Name == ".git" || e.Name == "binary" }) {
		t.Fatalf("ignored: %v %v", list, err)
	}
}
