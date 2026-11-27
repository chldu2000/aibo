package workbench

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/proc"
)

var (
	ErrPreviewBinary  = errors.New("binary or unsupported text encoding")
	ErrPreviewSpecial = errors.New("special file or link cannot be previewed")
)

const (
	maxDirectoryEntries = 4096
	maxPreviewBytes     = 512 << 10
)

type DirectoryEntry struct {
	Name      string
	Directory bool
}

type DirectoryListing struct {
	Entries   []DirectoryEntry
	Truncated bool
}

type TextPreview struct {
	Text      string
	Truncated bool
}

// openWorkspacePath resolves slash-separated, workspace-relative names
// through an OS-enforced root, including when a directory is replaced.
func (w *Workbench) openWorkspacePath(id, rel string) (*os.Root, string, error) {
	ws, ok := w.Workspace(id)
	if !ok {
		return nil, "", ErrNoSuchWorkspace
	}
	name, err := filepath.Localize(rel)
	if err != nil || !fs.ValidPath(rel) {
		return nil, "", ErrNotReadable
	}
	for _, part := range strings.Split(rel, "/") {
		if strings.EqualFold(part, ".git") {
			return nil, "", ErrNotReadable
		}
	}
	root, err := os.OpenRoot(ws.Path)
	return root, name, err
}

func (w *Workbench) BrowseDirectory(ctx context.Context, id, rel string) (DirectoryListing, error) {
	root, name, err := w.openWorkspacePath(id, rel)
	if err != nil {
		return DirectoryListing{}, err
	}
	defer root.Close()
	dir, err := root.OpenRoot(name)
	if err != nil {
		return DirectoryListing{}, err
	}
	defer dir.Close()
	f, err := dir.Open(".")
	if err != nil {
		return DirectoryListing{}, err
	}
	defer f.Close()
	entries, err := f.ReadDir(maxDirectoryEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return DirectoryListing{}, err
	}
	list := DirectoryListing{Truncated: len(entries) > maxDirectoryEntries}
	if list.Truncated {
		entries = entries[:maxDirectoryEntries]
	}
	var candidates bytes.Buffer
	for _, entry := range entries {
		if !strings.EqualFold(entry.Name(), ".git") {
			candidates.WriteString(path.Join(rel, entry.Name()))
			candidates.WriteByte(0)
		}
	}
	ignored := map[string]bool{}
	if candidates.Len() > 0 {
		cmd := exec.CommandContext(ctx, "git", "-C", root.Name(), "check-ignore", "--stdin", "-z")
		proc.Hide(cmd)
		cmd.Stdin = &candidates
		if out, err := cmd.Output(); err == nil {
			for _, item := range bytes.Split(out, []byte{0}) {
				ignored[string(item)] = true
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return DirectoryListing{}, err
	}
	for _, entry := range entries {
		if !strings.EqualFold(entry.Name(), ".git") && !ignored[path.Join(rel, entry.Name())] {
			list.Entries = append(list.Entries, DirectoryEntry{Name: entry.Name(), Directory: entry.IsDir()})
		}
	}
	slices.SortFunc(list.Entries, func(a, b DirectoryEntry) int {
		if a.Directory != b.Directory {
			if a.Directory {
				return -1
			}
			return 1
		}
		return strings.Compare(a.Name, b.Name)
	})
	return list, nil
}

func (w *Workbench) PreviewFile(ctx context.Context, id, rel string) (TextPreview, error) {
	root, name, err := w.openWorkspacePath(id, rel)
	if err != nil {
		return TextPreview{}, err
	}
	defer root.Close()
	info, err := root.Lstat(name)
	if err != nil {
		return TextPreview{}, err
	}
	if !info.Mode().IsRegular() {
		return TextPreview{}, ErrPreviewSpecial
	}
	f, err := root.OpenFile(name, os.O_RDONLY|previewNonblock, 0)
	if err != nil {
		return TextPreview{}, err
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil {
		return TextPreview{}, err
	}
	if !info.Mode().IsRegular() {
		return TextPreview{}, ErrPreviewSpecial
	}
	if err := ctx.Err(); err != nil {
		return TextPreview{}, err
	}
	b, err := io.ReadAll(io.LimitReader(f, maxPreviewBytes+1))
	if err != nil {
		return TextPreview{}, err
	}
	truncated := len(b) > maxPreviewBytes
	if truncated {
		end := maxPreviewBytes
		for end > maxPreviewBytes-utf8.UTFMax && !utf8.RuneStart(b[end]) {
			end--
		}
		b = b[:end]
	}
	if bytes.IndexByte(b, 0) >= 0 || !utf8.Valid(b) {
		return TextPreview{}, ErrPreviewBinary
	}
	return TextPreview{Text: string(b), Truncated: truncated}, nil
}
