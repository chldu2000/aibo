package main

import (
	"context"
	"path"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

func watchWorkspace(ctx context.Context, dir string, changed func()) error {
	watcher, err := mygo.WatchFiles(ctx, dir, mygo.FileWatchOptions{
		Recursive: true, HintsOnly: true, Debounce: 150 * time.Millisecond, MaxDelay: time.Second,
		Ignore: ignoreInWorkspace,
	})
	if err != nil {
		return err
	}
	defer watcher.Close()
	// Close the gap between starting the first read and installing the watch.
	changed()
	for {
		if _, err := watcher.Next(ctx); err != nil {
			return err
		}
		changed()
	}
}

// ignoreInWorkspace is what the workspace watch leaves alone: inside a
// repository's .git, every directory but refs. Its HEAD, index and refs
// say what the Git page shows, as a commit or a checkout changes them, and
// .git appearing is a repository made; what git keeps of the history
// (objects, logs) changes with every object it writes. The workbench's
// own git commands take no optional locks, so they do not write there.
func ignoreInWorkspace(name string, isDir bool) bool {
	if !isDir {
		return false
	}
	parent, base := path.Split(name)
	return strings.EqualFold(path.Base(strings.TrimSuffix(parent, "/")), ".git") && !strings.EqualFold(base, "refs")
}
