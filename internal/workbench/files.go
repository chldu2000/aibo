package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/files"
	"github.com/chldu2000/aibo/internal/model"
)

// ErrNotReadable is what sending a mention of a file outside the
// session's workspace and its source workspaces returns.
var ErrNotReadable = errors.New("the file is not in the session's workspace or a source workspace it reads")

// FileHit is a file or directory that matched what the user typed.
type FileHit struct {
	Mention model.Mention
	// Rel is its path in its workspace, a directory's ending with "/".
	Rel string
	// Workspace is the source workspace's path it is in; "" for the
	// session's own.
	Workspace string
}

// fileLists are the workspaces' files as last listed, by folder.
type fileLists struct {
	mu    sync.Mutex
	lists map[string]fileList
}

type fileList struct {
	paths []string
	all   bool
	at    time.Time
}

// fileListAge is how long a listing is used before it is made again.
const fileListAge = 30 * time.Second

// list returns root's files, listing them again when old.
func (w *Workbench) list(ctx context.Context, root string, all bool) ([]string, error) {
	f := &w.fileLists
	f.mu.Lock()
	l, ok := f.lists[root]
	f.mu.Unlock()
	if ok && l.all == all && w.now().Sub(l.at) < fileListAge {
		return l.paths, nil
	}
	paths, err := files.List(ctx, root, all)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	if f.lists == nil {
		f.lists = map[string]fileList{}
	}
	f.lists[root] = fileList{paths: paths, all: all, at: w.now()}
	f.mu.Unlock()
	return paths, nil
}

// roots are the folders a session's files may be mentioned from: its
// workspace, then the source workspaces it may read, with their IDs.
func (w *Workbench) roots(sessionID string) (own model.Workspace, sources []model.Workspace, err error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[sessionID]
	if !ok {
		return own, nil, ErrNoSuchSession
	}
	own, _ = w.workspace(s.info.WorkspaceID)
	for _, d := range s.info.ReadDirs {
		ws := model.Workspace{Path: d}
		for _, x := range w.workspaces {
			if x.Path == d {
				ws = x
			}
		}
		sources = append(sources, ws)
	}
	return own, sources, nil
}

// MatchFiles returns at most n files and directories of a session's
// workspace and of the source workspaces it may read that match query,
// its own first. It lists them, which may take a while the first time:
// not on the main thread.
func (w *Workbench) MatchFiles(ctx context.Context, sessionID, query string, n int) ([]FileHit, error) {
	own, sources, err := w.roots(sessionID)
	if err != nil {
		return nil, err
	}
	all := w.Settings().MentionIgnored
	var out []FileHit
	for i, ws := range append([]model.Workspace{own}, sources...) {
		if len(out) >= n {
			break
		}
		paths, err := w.list(ctx, ws.Path, all)
		if err != nil {
			if i == 0 {
				return nil, err
			}
			continue // a source workspace moved away
		}
		for _, rel := range files.Match(paths, query, n-len(out)) {
			dir := strings.HasSuffix(rel, "/")
			abs := filepath.Join(ws.Path, filepath.FromSlash(rel))
			if dir {
				abs += "/"
			}
			h := FileHit{Mention: model.Mention{Path: abs, WorkspaceID: ws.ID, Dir: dir}, Rel: rel}
			if i > 0 {
				h.Workspace = ws.Path
			}
			out = append(out, h)
		}
	}
	return out, nil
}

// MentionPath is a mention of a file or directory the user gave by its
// path, as one pasted or dropped: ErrNotReadable when it is not in the
// session's workspace or a source workspace it may read. It looks at the
// file: not on the main thread.
func (w *Workbench) MentionPath(sessionID, path string) (FileHit, error) {
	own, sources, err := w.roots(sessionID)
	if err != nil {
		return FileHit{}, err
	}
	fi, err := os.Stat(path)
	if err != nil {
		return FileHit{}, err
	}
	path = filepath.Clean(path)
	if fi.IsDir() {
		path += "/"
	}
	for i, ws := range append([]model.Workspace{own}, sources...) {
		rel, ok := relIn(ws.Path, path)
		if !ok {
			continue
		}
		h := FileHit{Mention: model.Mention{Path: path, WorkspaceID: ws.ID, Dir: fi.IsDir()}, Rel: rel}
		if i > 0 {
			h.Workspace = ws.Path
		}
		return h, nil
	}
	return FileHit{}, ErrNotReadable
}

// turnFiles are the mentions as the Agent gets them, relative to the
// workspace root when in it; ok is false when one is in neither root nor
// readable.
func turnFiles(mentions []model.Mention, root string, readable []string) ([]agent.FileMention, bool) {
	var out []agent.FileMention
	for _, m := range mentions {
		f := agent.FileMention{Path: m.Path, Dir: m.Dir}
		if rel, ok := relIn(root, m.Path); ok {
			f.Rel = rel
		} else if !slicesAny(readable, func(d string) bool { _, ok := relIn(d, m.Path); return ok }) {
			return nil, false
		}
		out = append(out, f)
	}
	return out, true
}

// relIn is p relative to root, if it is under it; a directory keeps its
// trailing "/".
func relIn(root, p string) (string, bool) {
	rel, err := filepath.Rel(root, strings.TrimSuffix(p, "/"))
	if err != nil || rel == "." || !filepath.IsLocal(rel) {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if strings.HasSuffix(p, "/") {
		rel += "/"
	}
	return rel, true
}

func slicesAny(xs []string, f func(string) bool) bool {
	for _, x := range xs {
		if f(x) {
			return true
		}
	}
	return false
}
