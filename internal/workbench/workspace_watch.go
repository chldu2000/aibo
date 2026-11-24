package workbench

import (
	"context"
	"sync"
)

type workspaceWatch struct {
	users  int
	cancel context.CancelFunc
}

func (w *Workbench) clearReadsLocked(id string) {
	for key, read := range w.browseReads {
		if key.workspace == id {
			read.cancel()
			delete(w.browseReads, key)
		}
	}
}

func (w *Workbench) RefreshWorkspace(id string) {
	w.mu.Lock()
	w.clearReadsLocked(id)
	w.mu.Unlock()
	w.notify(Change{})
}

// ObserveWorkspace shares one watcher among the windows showing this workspace.
// The last window releases both cached data and in-flight reads.
func (w *Workbench) ObserveWorkspace(id string) func() {
	ws, ok := w.Workspace(id)
	if !ok {
		return func() {}
	}
	w.mu.Lock()
	if w.closing {
		w.mu.Unlock()
		return func() {}
	}
	if w.watches == nil {
		w.watches = make(map[string]*workspaceWatch)
	}
	watch := w.watches[id]
	if watch == nil {
		ctx, cancel := context.WithCancel(context.Background())
		watch = &workspaceWatch{cancel: cancel}
		w.watches[id] = watch
		w.clearReadsLocked(id)
		if w.watchWorkspace != nil {
			w.pumps.Add(1)
			go func() {
				defer w.pumps.Done()
				changed := func() {
					w.mu.Lock()
					active := w.watches[id] == watch && !w.closing
					if active {
						w.clearReadsLocked(id)
					}
					w.mu.Unlock()
					if active {
						w.notify(Change{})
					}
				}
				if err := w.watchWorkspace(ctx, ws.Path, changed); err != nil && ctx.Err() == nil {
					w.log.Warn("workspace watch stopped", "error", err)
				}
			}()
		}
	}
	if watch.users > 0 {
		// A newly visible window revalidates finished snapshots, while
		// joining reads already running for another visible window.
		for key, read := range w.browseReads {
			if key.workspace == id && !read.pending {
				delete(w.browseReads, key)
			}
		}
	}
	watch.users++
	w.mu.Unlock()
	return sync.OnceFunc(func() {
		w.mu.Lock()
		defer w.mu.Unlock()
		watch.users--
		if watch.users == 0 {
			watch.cancel()
			delete(w.watches, id)
			w.clearReadsLocked(id)
		}
	})
}
