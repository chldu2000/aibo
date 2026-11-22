package store_test

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/store"

	_ "modernc.org/sqlite"
)

// A database of an older schema is backed up before it is upgraded.
func TestBackupBeforeUpgrade(t *testing.T) {
	dir := t.TempDir()
	// A database one version back, with a workspace.
	if err := store.OpenVersion(dir, store.SchemaVersion()-1); err != nil {
		t.Fatal(err)
	}
	db, _ := sql.Open("sqlite", "file:"+filepath.Join(dir, store.DBFile))
	db.Exec(`INSERT INTO workspaces (id, path, created_at) VALUES ('w', '/p', 0)`)
	db.Close()

	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	var backups []string
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".bak") {
			backups = append(backups, e.Name())
		}
	}
	want := fmt.Sprintf("%s.v%d-", store.DBFile, store.SchemaVersion()-1)
	if len(backups) != 1 || !strings.HasPrefix(backups[0], want) {
		t.Fatalf("backups = %v, want one %s…", backups, want)
	}
	// The backup is the database as it was: its workspace, its version.
	old, _ := sql.Open("sqlite", "file:"+filepath.Join(dir, backups[0])+"?mode=ro")
	defer old.Close()
	var n, v int
	old.QueryRow(`SELECT count(*) FROM workspaces`).Scan(&n)
	old.QueryRow(`PRAGMA user_version`).Scan(&v)
	if n != 1 || v != store.SchemaVersion()-1 {
		t.Errorf("backup has %d workspaces at version %d", n, v)
	}
	// The upgraded one works.
	if _, err := st.Workspaces(); err != nil {
		t.Errorf("after the upgrade: %v", err)
	}

	// An up-to-date database is not backed up again.
	st.Close()
	st2, _ := store.Open(dir)
	st2.Close()
	entries, _ = os.ReadDir(dir)
	count := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".bak") {
			count++
		}
	}
	if count != 1 {
		t.Errorf("%d backups after reopening", count)
	}
}

// The approval levels of sessions before ADR 0003 become each Agent's
// own permission modes; Codex's ask and edits were the same.
func TestLevelsBecomeModes(t *testing.T) {
	dir := t.TempDir()
	if err := store.OpenVersion(dir, store.SchemaVersion()-1); err != nil {
		t.Fatal(err)
	}
	db, _ := sql.Open("sqlite", "file:"+filepath.Join(dir, store.DBFile))
	db.Exec(`INSERT INTO workspaces (id, path, created_at) VALUES ('w', '/p', 0)`)
	for i, s := range []struct{ agent, level string }{
		{"claude", "ask"}, {"claude", "edits"}, {"claude", "auto"},
		{"codex", "ask"}, {"codex", "edits"}, {"codex", "auto"}, {"fake", "auto"},
	} {
		if _, err := db.Exec(`INSERT INTO sessions (id, workspace_id, agent, approval_level, created_at, active_at) VALUES (?, 'w', ?, ?, ?, ?)`,
			fmt.Sprint(i), s.agent, s.level, i, i); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	xs, err := st.Sessions()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, x := range xs {
		got[x.ID] = x.Mode
	}
	want := map[string]string{"0": "default", "1": "acceptEdits", "2": "bypassPermissions",
		"3": "ask-for-approval", "4": "ask-for-approval", "5": "full-access", "6": "auto"}
	for id, w := range want {
		if got[id] != w {
			t.Errorf("session %s: %q, want %q", id, got[id], w)
		}
	}
}
