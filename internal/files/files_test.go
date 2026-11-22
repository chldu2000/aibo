package files_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/files"
)

func write(t *testing.T, root string, paths ...string) {
	t.Helper()
	for _, p := range paths {
		full := filepath.Join(root, p)
		os.MkdirAll(filepath.Dir(full), 0o755)
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// In a git repository the list keeps to what git does not ignore, unless
// all is asked for; directories are listed too, ending with "/"; .git
// never is.
func TestListKeepsToGitignore(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	write(t, root, ".gitignore", "src/main.go", "src/util/str.go", "build/out.bin", "notes.txt")
	os.WriteFile(filepath.Join(root, ".gitignore"), []byte("build/\n"), 0o644)

	got, err := files.List(context.Background(), root, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{".gitignore", "notes.txt", "src/", "src/main.go", "src/util/", "src/util/str.go"}
	if !slices.Equal(got, want) {
		t.Errorf("list = %v, want %v", got, want)
	}
	all, _ := files.List(context.Background(), root, true)
	if !slices.Contains(all, "build/out.bin") || slices.ContainsFunc(all, func(p string) bool { return p == ".git/" || len(p) > 5 && p[:5] == ".git/" }) {
		t.Errorf("all = %v", all)
	}
}

// Outside a repository everything is listed, but .git.
func TestListWithoutGit(t *testing.T) {
	root := t.TempDir()
	write(t, root, "a.txt", "dir/b.txt")
	got, err := files.List(context.Background(), root, false)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"a.txt", "dir/", "dir/b.txt"}; !slices.Equal(got, want) {
		t.Errorf("list = %v, want %v", got, want)
	}
}

// Fuzzy: the query's letters in order; a file named by it first, then a
// shorter path.
func TestMatch(t *testing.T) {
	paths := []string{"internal/shell/pull.go", "internal/shell/pull_internal_test.go", "docs/pull-requests.md", "internal/", "README.md", "cmd/aibo/main.go"}
	got := files.Match(paths, "pull", 10)
	if len(got) != 3 || got[0] != "internal/shell/pull.go" {
		t.Errorf("pull → %v", got)
	}
	if got := files.Match(paths, "ishpu", 10); len(got) == 0 || got[0] != "internal/shell/pull.go" {
		t.Errorf("ishpu → %v", got)
	}
	if got := files.Match(paths, "MAIN", 10); !slices.Equal(got, []string{"cmd/aibo/main.go"}) {
		t.Errorf("MAIN → %v", got)
	}
	if got := files.Match(paths, "zzz", 10); len(got) != 0 {
		t.Errorf("zzz → %v", got)
	}
	if got := files.Match(paths, "", 2); len(got) != 2 {
		t.Errorf("empty → %v", got)
	}
}

// A hundred thousand paths match in well under the time of a keystroke.
func BenchmarkMatch(b *testing.B) {
	paths := make([]string, 100000)
	for i := range paths {
		paths[i] = fmt.Sprintf("pkg%03d/module%02d/file_%05d.go", i%500, i%37, i)
	}
	b.ResetTimer()
	for b.Loop() {
		files.Match(paths, "mod12file", 20)
	}
}
