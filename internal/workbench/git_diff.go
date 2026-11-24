package workbench

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

type ChangeDiff struct {
	Patch, AddedText     string
	Untracked, Truncated bool
	Missing              bool
}

func (w *Workbench) ReadChangeDiff(ctx context.Context, id string, ch GitChange) (ChangeDiff, error) {
	// Recheck membership at selection time. The index or working tree may
	// have changed since the status list was drawn.
	status, err := w.RepositoryStatus(ctx, id)
	if err != nil {
		return ChangeDiff{}, err
	}
	if !slices.Contains(status.Changes, ch) {
		return ChangeDiff{Missing: true}, nil
	}
	if ch.Group == GitConflict {
		return ChangeDiff{}, nil
	}
	if ch.Group == GitUntracked {
		preview, err := w.PreviewFile(ctx, id, ch.Path)
		return ChangeDiff{Untracked: true, AddedText: preview.Text, Truncated: preview.Truncated}, err
	}
	ws, ok := w.Workspace(id)
	if !ok {
		return ChangeDiff{}, ErrNoSuchWorkspace
	}
	args := []string{"diff", "--relative", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames", "--submodule=short", "--src-prefix=a/", "--dst-prefix=b/"}
	if ch.Group == GitStaged {
		args = append(args, "--cached")
	}
	args = append(args, "--", ch.Path)
	if ch.Original != "" {
		args = append(args, ch.Original)
	}
	patch, err := readGit(ctx, ws.Path, maxPreviewBytes, args...)
	return ChangeDiff{Patch: patch}, err
}

func (w *Workbench) Diff(id string, ch GitChange) Snapshot[ChangeDiff] {
	key := workspaceReadKey{id, "diff", strings.Join([]string{fmt.Sprint(ch.Group), ch.Code, ch.Path, ch.Original}, "\x00")}
	return readWorkspace(w, key, func(ctx context.Context) (ChangeDiff, error) { return w.ReadChangeDiff(ctx, id, ch) })
}
