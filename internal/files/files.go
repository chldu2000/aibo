// Package files lists a workspace's files for the user to mention in a
// message, and matches them against what the user types. It keeps to what
// git does not ignore, unless asked for all.
package files

import (
	"bytes"
	"context"
	"io/fs"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

// most is the most entries listed: beyond it the rest is left out.
const most = 200000

// List returns the files and directories under root, relative to it,
// slash-separated, directories ending with "/", sorted. In a git
// repository it leaves out what git ignores (.gitignore and the like)
// unless all is set; outside one, and with all, it lists everything but
// .git.
func List(ctx context.Context, root string, all bool) ([]string, error) {
	var fileList []string
	if !all {
		if fs, ok := gitFiles(ctx, root); ok {
			fileList = fs
		}
	}
	if fileList == nil {
		var err error
		if fileList, err = walk(ctx, root); err != nil {
			return nil, err
		}
	}
	// The directories the files are in.
	seen := map[string]bool{}
	out := make([]string, 0, len(fileList)*5/4)
	for _, f := range fileList {
		out = append(out, f)
		for d := path.Dir(f); d != "." && !seen[d]; d = path.Dir(d) {
			seen[d] = true
			out = append(out, d+"/")
		}
	}
	sort.Strings(out)
	return out, nil
}

// gitFiles are the files git tracks or would add under root; ok is false
// when root is not in a repository, or git cannot be run.
func gitFiles(ctx context.Context, root string) ([]string, bool) {
	cmd := exec.CommandContext(ctx, "git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	out, err := cmd.Output()
	if err != nil {
		return nil, false
	}
	var fileList []string
	for _, f := range bytes.Split(out, []byte{0}) {
		if len(f) > 0 && len(fileList) < most {
			fileList = append(fileList, string(f))
		}
	}
	return slices.Compact(fileList), true // a file conflicted shows more than once
}

// walk lists every file under root but those in .git.
func walk(ctx context.Context, root string) ([]string, error) {
	var fileList []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable: left out
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			if d.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if len(fileList) >= most {
			return filepath.SkipAll
		}
		rel, err := filepath.Rel(root, p)
		if err == nil {
			fileList = append(fileList, filepath.ToSlash(rel))
		}
		return nil
	})
	return fileList, err
}

// Match returns at most n of paths that hold the query's letters in order,
// regardless of case, best first: those whose name holds them together,
// then those whose segments start with them, then the shorter. An empty
// query matches the first n.
func Match(paths []string, query string, n int) []string {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return paths[:min(n, len(paths))]
	}
	type hit struct {
		p     string
		score int
	}
	var hits []hit
	for _, p := range paths {
		if s, ok := score(p, query); ok {
			hits = append(hits, hit{p, s})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return len(hits[i].p) < len(hits[j].p)
	})
	out := make([]string, 0, min(n, len(hits)))
	for _, h := range hits[:min(n, len(hits))] {
		out = append(out, h.p)
	}
	return out
}

// score scores p against the lowercase query, if it holds its letters in
// order.
func score(p, query string) (int, bool) {
	lower := strings.ToLower(p)
	name := path.Base(strings.TrimSuffix(lower, "/"))
	s := 0
	switch {
	case strings.TrimSuffix(name, path.Ext(name)) == query:
		s += 1000
	case strings.HasPrefix(name, query):
		s += 600
	case strings.Contains(name, query):
		s += 400
	case strings.Contains(lower, query):
		s += 200
	}
	// The letters in order, more for each that starts a segment or
	// follows the one before.
	i, prev := 0, -2
	for j := 0; j < len(lower) && i < len(query); {
		r, size := utf8.DecodeRuneInString(lower[j:])
		q, qsize := utf8.DecodeRuneInString(query[i:])
		if r == q {
			if j == 0 || strings.ContainsRune("/_-. ", rune(lower[j-1])) {
				s += 10
			}
			if prev == j-1 {
				s += 5
			}
			prev = j + size - 1
			i += qsize
		}
		j += size
	}
	return s, i == len(query)
}
