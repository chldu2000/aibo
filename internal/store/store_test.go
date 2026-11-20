package store_test

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/store"

	_ "modernc.org/sqlite"
)

// A database of an older schema is backed up before it is upgraded.
func TestBackupBeforeUpgrade(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	st.AddWorkspace(model.Workspace{ID: "w", Path: "/p", CreatedAt: now})
	st.Close()
	// Back one version: the last migration (the settings) not yet run.
	db, _ := sql.Open("sqlite", "file:"+filepath.Join(dir, store.DBFile))
	db.Exec(`DROP TABLE settings`)
	db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, store.SchemaVersion()-1))
	db.Close()

	st, err = store.Open(dir)
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
	if err := st.SetSetting("k", 1); err != nil {
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
