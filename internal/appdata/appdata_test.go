package appdata_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/appdata"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/store"
)

func TestConfigAndResolve(t *testing.T) {
	def := filepath.Join(t.TempDir(), "aibo")
	c, err := appdata.LoadConfig(def)
	if err != nil || c.DataDir != "" {
		t.Fatalf("no config: %+v, %v", c, err)
	}
	dir, err := appdata.Resolve(def, c)
	if err != nil || dir != def {
		t.Fatalf("default: %s, %v", dir, err)
	}
	if fi, err := os.Stat(def); err != nil || !fi.IsDir() {
		t.Error("the default directory was not made")
	}

	custom := t.TempDir()
	if err := appdata.SaveConfig(def, appdata.Config{DataDir: custom}); err != nil {
		t.Fatal(err)
	}
	c, _ = appdata.LoadConfig(def)
	if dir, err := appdata.Resolve(def, c); err != nil || dir != custom {
		t.Errorf("custom: %s, %v", dir, err)
	}
	// A chosen directory that is gone is not made again, empty.
	gone := filepath.Join(t.TempDir(), "unmounted")
	if _, err := appdata.Resolve(def, appdata.Config{DataDir: gone}); !errors.Is(err, appdata.ErrUnavailable) {
		t.Errorf("a missing directory: %v", err)
	}
	if _, err := os.Stat(gone); err == nil {
		t.Error("the missing directory was made")
	}
}

func TestLock(t *testing.T) {
	dir := t.TempDir()
	release, err := appdata.Lock(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := appdata.Lock(dir); !errors.Is(err, appdata.ErrLocked) {
		t.Errorf("a second lock: %v", err)
	}
	release()
	again, err := appdata.Lock(dir)
	if err != nil {
		t.Fatalf("after release: %v", err)
	}
	again()
}

func TestSyncFolder(t *testing.T) {
	for path, want := range map[string]string{
		"/Users/me/Library/Mobile Documents/com~apple~CloudDocs/aibo":    "iCloud Drive",
		"/Users/me/Library/CloudStorage/GoogleDrive-me@example.com/aibo": "GoogleDrive",
		"/Users/me/Dropbox/aibo":   "Dropbox",
		"/Users/me/Documents/aibo": "",
	} {
		got, ok := appdata.SyncFolder(path)
		if got != want || ok != (want != "") {
			t.Errorf("%s: %q %v", path, got, ok)
		}
	}
}

// seed makes aibo's data in dir: a database with a session.
func seed(t *testing.T, dir string) {
	t.Helper()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	st.AddWorkspace(model.Workspace{ID: "w", Path: "/p", CreatedAt: now})
	st.CreateSession(model.Session{ID: "s", WorkspaceID: "w", Agent: "fake", CreatedAt: now, ActiveAt: now})
	st.AppendMessage("s", model.Message{Kind: model.UserMessage, State: model.Done, Text: "要搬走的消息", CreatedAt: now})
	st.Close()
	os.MkdirAll(filepath.Join(dir, "attachments", "s"), 0o755)
	os.WriteFile(filepath.Join(dir, "attachments", "s", "a.png"), []byte("png"), 0o644)
}

func TestMoveToAnEmptyFolder(t *testing.T) {
	from, to := t.TempDir(), t.TempDir()
	seed(t, from)
	appdata.SaveConfig(from, appdata.Config{DataDir: to})
	if err := os.WriteFile(filepath.Join(from, "agents.json"), []byte("[]"), 0600); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(from, "aibo.db.v1.bak"), []byte("old"), 0o644)

	if err := appdata.Move(from, to); err != nil {
		t.Fatal(err)
	}
	if appdata.HasData(from) {
		t.Error("the data stayed behind")
	}
	if data, err := os.ReadFile(filepath.Join(to, "agents.json")); err != nil || string(data) != "[]" {
		t.Fatal("Agent configuration did not move")
	}
	if _, err := os.Stat(filepath.Join(from, "attachments")); err == nil {
		t.Error("the attachments stayed behind")
	}
	for _, kept := range []string{appdata.ConfigFile, "aibo.db.v1.bak"} {
		if _, err := os.Stat(filepath.Join(from, kept)); err != nil {
			t.Errorf("%s was removed", kept)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(to, "attachments", "s", "a.png")); string(b) != "png" {
		t.Error("the attachments did not move")
	}
	st, err := store.Open(to)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if ms, _ := st.Messages("s"); len(ms) != 1 || ms[0].Text != "要搬走的消息" {
		t.Errorf("messages after moving = %+v", ms)
	}
}

func TestMoveToAFolderWithData(t *testing.T) {
	from, to := t.TempDir(), t.TempDir()
	seed(t, from)
	seed(t, to)
	os.WriteFile(filepath.Join(to, "marker"), []byte("theirs"), 0o644)
	if err := appdata.Move(from, to); err != nil {
		t.Fatal(err)
	}
	// Nothing moves: to's data is used as it is, from's stays.
	if !appdata.HasData(from) {
		t.Error("the old data was removed")
	}
	if b, _ := os.ReadFile(filepath.Join(to, "marker")); string(b) != "theirs" {
		t.Error("the target was touched")
	}
}

func TestMoveRefusesAFolderWithOtherThings(t *testing.T) {
	from, to := t.TempDir(), t.TempDir()
	seed(t, from)
	os.WriteFile(filepath.Join(to, "notes.txt"), []byte("mine"), 0o644)
	if err := appdata.Move(from, to); !errors.Is(err, appdata.ErrNotEmpty) {
		t.Errorf("moving into a folder with other files: %v", err)
	}
	if !appdata.HasData(from) {
		t.Error("the data left anyway")
	}
}
