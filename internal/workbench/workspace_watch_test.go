package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestVisibleWorkspaceReads(t *testing.T) {
	hints := make(chan func(), 4)
	stops := make(chan struct{}, 4)
	w, err := Open(Options{DataDir: t.TempDir(), WatchWorkspace: func(ctx context.Context, dir string, hint func()) error {
		hints <- hint
		<-ctx.Done()
		stops <- struct{}{}
		return ctx.Err()
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	dir := t.TempDir()
	ws, _ := w.AddWorkspace(dir)
	other, _ := w.AddWorkspace(t.TempDir())
	first := w.ObserveWorkspace(ws.ID)
	hint := <-hints
	key := workspaceReadKey{ws.ID, "test", "same"}
	var count atomic.Int32
	gate := make(chan struct{})
	defer close(gate)
	load := func(ctx context.Context) (int, error) {
		n := int(count.Add(1))
		if n == 1 {
			<-gate
		}
		return n, nil
	}
	until := func(cond func() bool) {
		t.Helper()
		for end := time.Now().Add(3 * time.Second); time.Now().Before(end); {
			if cond() {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal("timed out")
	}
	readWorkspace(w, key, load)
	until(func() bool { return count.Load() == 1 })
	second := w.ObserveWorkspace(ws.ID)
	for range 40 {
		if !readWorkspace(w, key, load).Pending {
			t.Fatal("expected one blocked read")
		}
	}
	if count.Load() != 1 || len(hints) != 0 {
		t.Fatal("duplicated watcher or read")
	}
	hint()
	until(func() bool { return readWorkspace(w, key, load).Value == 2 })
	first()
	if len(stops) != 0 {
		t.Fatal("stopped with another observer")
	}
	file := filepath.Join(dir, "file")
	if err := os.WriteFile(file, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	until(func() bool { return w.FilePreview(ws.ID, "file").Value.Text == "before" })
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	hint()
	until(func() bool { return errors.Is(w.FilePreview(ws.ID, "file").Err, os.ErrNotExist) })
	second()
	<-stops
	release := w.ObserveWorkspace(other.ID)
	<-hints
	otherKey := workspaceReadKey{other.ID, "test", "same"}
	until(func() bool { return readWorkspace(w, otherKey, load).Value == 3 })
	hint() // a late callback from the old workspace
	if r := readWorkspace(w, otherKey, load); r.Pending || r.Value != 3 {
		t.Fatal(r)
	}
	release()
	<-stops
}
