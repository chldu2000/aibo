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
		Ignore: func(name string, isDir bool) bool { return isDir && strings.EqualFold(path.Base(name), ".git") },
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
