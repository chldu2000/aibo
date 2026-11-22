// Package diag is aibo's diagnostic log: what happened to sessions and
// Agents, for the user and developers to look at when something goes
// wrong, without a debugger. It writes one file a day under the data
// directory's logs/, and keeps the last 14 days.
//
// It never holds what the user or the model said, references, tokens or
// credentials: the packages writing to it keep to that (agent.Shape).
package diag

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Dir is the logs' directory in the data directory.
const Dir = "logs"

// keep is how many days of logs stay.
const keep = 14

// Log is the open diagnostic log.
type Log struct {
	// Logger writes to it.
	Logger *slog.Logger
	w      *writer
}

// Open opens the log under dataDir; now tells the day (time.Now when nil).
func Open(dataDir string, now func() time.Time) (*Log, error) {
	if now == nil {
		now = time.Now
	}
	dir := filepath.Join(dataDir, Dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	w := &writer{dir: dir, now: now}
	return &Log{Logger: slog.New(slog.NewTextHandler(w, nil)), w: w}, nil
}

// Close closes the day's file.
func (l *Log) Close() error {
	l.w.mu.Lock()
	defer l.w.mu.Unlock()
	if l.w.f == nil {
		return nil
	}
	err := l.w.f.Close()
	l.w.f = nil
	return err
}

// writer writes to the day's file, starting a new one, and pruning old
// ones, as the day changes.
type writer struct {
	dir string
	now func() time.Time

	mu  sync.Mutex
	day string
	f   *os.File
}

func (w *writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	day := w.now().Format("2006-01-02")
	if day != w.day || w.f == nil {
		if w.f != nil {
			w.f.Close()
		}
		f, err := os.OpenFile(filepath.Join(w.dir, "aibo-"+day+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return 0, err
		}
		w.f, w.day = f, day
		w.prune()
	}
	return w.f.Write(p)
}

// prune removes the logs of more than keep days ago.
func (w *writer) prune() {
	oldest := w.now().AddDate(0, 0, -keep).Format("2006-01-02")
	entries, err := os.ReadDir(w.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		day, ok := strings.CutPrefix(e.Name(), "aibo-")
		day, ok2 := strings.CutSuffix(day, ".log")
		if ok && ok2 && day < oldest {
			if err := os.Remove(filepath.Join(w.dir, e.Name())); err != nil {
				fmt.Fprintln(os.Stderr, "diag:", err)
			}
		}
	}
}
