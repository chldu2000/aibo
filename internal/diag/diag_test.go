package diag_test

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/diag"
)

// The log goes to one file a day under logs/; a new day starts a new file,
// and files older than 14 days go.
func TestDailyFilesKeptFourteenDays(t *testing.T) {
	dir := t.TempDir()
	logs := filepath.Join(dir, diag.Dir)
	os.MkdirAll(logs, 0o755)
	day := time.Date(2026, 11, 22, 10, 0, 0, 0, time.Local)
	for _, old := range []int{-15, -14, -13} {
		name := "aibo-" + day.AddDate(0, 0, old).Format("2006-01-02") + ".log"
		os.WriteFile(filepath.Join(logs, name), []byte("old\n"), 0o644)
	}
	os.WriteFile(filepath.Join(logs, "notes.txt"), nil, 0o644) // not a log: kept

	now := day
	l, err := diag.Open(dir, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	l.Logger.Info("first", "session", "s1")
	now = day.Add(24 * time.Hour)
	l.Logger.Info("second")

	var names []string
	entries, _ := os.ReadDir(logs)
	for _, e := range entries {
		names = append(names, e.Name())
	}
	want := []string{"aibo-2026-11-09.log", "aibo-2026-11-22.log", "aibo-2026-11-23.log", "notes.txt"}
	if !slices.Equal(names, want) {
		t.Errorf("files = %v, want %v", names, want)
	}
	b, _ := os.ReadFile(filepath.Join(logs, "aibo-2026-11-22.log"))
	if !strings.Contains(string(b), "msg=first") || !strings.Contains(string(b), "session=s1") || strings.Contains(string(b), "second") {
		t.Errorf("first day's file: %s", b)
	}
	b, _ = os.ReadFile(filepath.Join(logs, "aibo-2026-11-23.log"))
	if !strings.Contains(string(b), "msg=second") {
		t.Errorf("second day's file: %s", b)
	}
}
