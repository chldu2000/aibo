package workbench

import "context"

// Snapshot is an immutable, nonblocking workspace read, shared by windows.
type Snapshot[T any] struct {
	Value   T
	Pending bool
	Err     error
}

type workspaceReadKey struct{ workspace, kind, path string }
type workspaceRead struct {
	cancel  context.CancelFunc
	value   any
	err     error
	pending bool
}

func readWorkspace[T any](w *Workbench, key workspaceReadKey, load func(context.Context) (T, error)) Snapshot[T] {
	w.mu.Lock()
	defer w.mu.Unlock()
	if r := w.browseReads[key]; r != nil {
		snap := Snapshot[T]{Pending: r.pending, Err: r.err}
		if !r.pending {
			snap.Value = r.value.(T)
		}
		return snap
	}
	if w.closing {
		return Snapshot[T]{Err: context.Canceled}
	}
	if w.browseReads == nil {
		w.browseReads = make(map[workspaceReadKey]*workspaceRead)
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &workspaceRead{cancel: cancel, pending: true}
	w.browseReads[key] = r
	w.pumps.Add(1)
	go func() {
		defer w.pumps.Done()
		defer cancel()
		value, err := load(ctx)
		w.mu.Lock()
		current := !w.closing && w.browseReads[key] == r
		if current {
			r.value, r.err, r.pending = value, err, false
		}
		w.mu.Unlock()
		if current {
			w.notify(Change{})
		}
	}()
	return Snapshot[T]{Pending: true}
}

func (w *Workbench) Directory(id, rel string) Snapshot[DirectoryListing] {
	return readWorkspace(w, workspaceReadKey{id, "directory", rel}, func(ctx context.Context) (DirectoryListing, error) {
		return w.BrowseDirectory(ctx, id, rel)
	})
}

func (w *Workbench) FilePreview(id, rel string) Snapshot[TextPreview] {
	return readWorkspace(w, workspaceReadKey{id, "file", rel}, func(ctx context.Context) (TextPreview, error) {
		return w.PreviewFile(ctx, id, rel)
	})
}
