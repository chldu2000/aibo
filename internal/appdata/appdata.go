// Package appdata finds aibo's data directory and keeps it safe: where it
// is (a small config file at the default location), whether it is there,
// one aibo at a time on it, and moving it elsewhere. aibo never puts an
// empty database where the user's data should be.
package appdata

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// ConfigFile is the config file's name in the default directory. It is
// the only thing kept there when the data lives elsewhere.
const ConfigFile = "config.json"

// DBFile is the database's name in the data directory.
const DBFile = "aibo.db"

// dataFiles are what a data directory holds, besides the database's
// backups: what moves with it.
var dataFiles = []string{DBFile, DBFile + "-wal", DBFile + "-shm", "attachments"}

// Errors of the data directory.
var (
	ErrUnavailable = errors.New("数据目录不可用")
	ErrLocked      = errors.New("数据目录正被另一个 aibo 使用")
	ErrNotEmpty    = errors.New("目标文件夹里有别的东西")
)

// Config is what the config file holds.
type Config struct {
	// DataDir is the data directory the user chose; empty for the
	// default one.
	DataDir string `json:"dataDir,omitempty"`
}

// DefaultDir is the default data directory, where the config file always
// is: ~/Library/Application Support/aibo.
func DefaultDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Application Support", "aibo"), nil
}

// LoadConfig reads the config file in the default directory def; none
// is the default config.
func LoadConfig(def string) (Config, error) {
	var c Config
	b, err := os.ReadFile(filepath.Join(def, ConfigFile))
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("配置文件 %s 无法解析：%w", filepath.Join(def, ConfigFile), err)
	}
	return c, nil
}

// SaveConfig writes the config file in the default directory def.
func SaveConfig(def string, c Config) error {
	if err := os.MkdirAll(def, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(def, ConfigFile+".tmp")
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(def, ConfigFile))
}

// Resolve returns the data directory to open: the one configured, which
// must be there (ErrUnavailable: a moved folder, an unmounted disk), or
// the default one, made if needed.
func Resolve(def string, c Config) (string, error) {
	if c.DataDir == "" || filepath.Clean(c.DataDir) == filepath.Clean(def) {
		return def, os.MkdirAll(def, 0o755)
	}
	fi, err := os.Stat(c.DataDir)
	if err != nil || !fi.IsDir() {
		return c.DataDir, fmt.Errorf("%w：%s", ErrUnavailable, c.DataDir)
	}
	return c.DataDir, nil
}

// HasData reports whether dir holds aibo's data.
func HasData(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, DBFile))
	return err == nil
}

// syncFolders are where sync services keep their folders on macOS: data
// there is synced while aibo writes it, which a database does not survive
// well.
var syncFolders = []struct{ part, name string }{
	{"/Library/Mobile Documents/", "iCloud Drive"},
	{"/Library/CloudStorage/", "云盘"},
	{"/Dropbox", "Dropbox"},
	{"/Google Drive", "Google Drive"},
	{"/OneDrive", "OneDrive"},
	{"/Box Sync", "Box"},
}

// SyncFolder names the sync service whose folder path is in, if any.
func SyncFolder(path string) (string, bool) {
	p := filepath.Clean(path) + "/"
	for _, s := range syncFolders {
		if strings.Contains(p, s.part) {
			if s.part == "/Library/CloudStorage/" {
				// ~/Library/CloudStorage/<Provider>-<account>/…
				rest := p[strings.Index(p, s.part)+len(s.part):]
				if i := strings.IndexAny(rest, "-/"); i > 0 {
					return rest[:i], true
				}
			}
			return s.name, true
		}
	}
	return "", false
}

// Move moves the data from the directory from to the directory to, which
// must exist: when to already holds aibo's data, nothing moves and to is
// used as it is; else the data is copied, checked, and only then removed
// from from. The database must be closed. Backups and the config file
// stay where they are.
func Move(from, to string) error {
	if filepath.Clean(from) == filepath.Clean(to) {
		return nil
	}
	if HasData(to) {
		return nil
	}
	entries, err := os.ReadDir(to)
	if err != nil {
		return fmt.Errorf("%w：%s", ErrUnavailable, to)
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), ".") {
			return fmt.Errorf("%w：%s。请选一个空文件夹，或已有 aibo 数据的文件夹", ErrNotEmpty, to)
		}
	}
	var copied []string
	undo := func() {
		for _, p := range copied {
			os.RemoveAll(p)
		}
	}
	for _, name := range dataFiles {
		src := filepath.Join(from, name)
		if _, err := os.Stat(src); errors.Is(err, os.ErrNotExist) {
			continue
		}
		dst := filepath.Join(to, name)
		copied = append(copied, dst)
		if err := copyAll(src, dst); err != nil {
			undo()
			return fmt.Errorf("复制 %s 失败：%w", name, err)
		}
	}
	if err := verify(from, to); err != nil {
		undo()
		return err
	}
	for _, name := range dataFiles {
		os.RemoveAll(filepath.Join(from, name))
	}
	return nil
}

// verify checks the copy: every file the same size, and the database
// whole by SQLite's own check.
func verify(from, to string) error {
	for _, name := range dataFiles {
		src := filepath.Join(from, name)
		if _, err := os.Stat(src); errors.Is(err, os.ErrNotExist) {
			continue
		}
		err := filepath.Walk(src, func(p string, fi os.FileInfo, err error) error {
			if err != nil || fi.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(from, p)
			got, err := os.Stat(filepath.Join(to, rel))
			if err != nil || got.Size() != fi.Size() {
				return fmt.Errorf("校验失败：%s 没有完整复制", rel)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	if !HasData(to) {
		return nil
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(to, DBFile)+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	var ok string
	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&ok); err != nil || ok != "ok" {
		return fmt.Errorf("校验失败：复制后的数据库不完整（%v %s）", err, ok)
	}
	return nil
}

func copyAll(src, dst string) error {
	fi, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !fi.IsDir() {
		return copyFile(src, dst, fi.Mode())
	}
	return filepath.Walk(src, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if fi.IsDir() {
			return os.MkdirAll(target, fi.Mode().Perm())
		}
		return copyFile(p, target, fi.Mode())
	})
}

// copyFile copies a file, a stream at a time: the database can be large.
func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
