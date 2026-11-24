package appdata

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// LockFile is the lock's file in the data directory.
const LockFile = "aibo.lock"

// Lock takes the data directory for this process alone, until the
// returned function releases it (or the process ends): a second aibo on
// the same data gets ErrLocked.
func Lock(dir string) (release func(), err error) {
	f, err := os.OpenFile(filepath.Join(dir, LockFile), os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, fmt.Errorf("%w：%v", ErrUnavailable, err)
	}
	if err := tryLock(f); err != nil {
		f.Close()
		if errors.Is(err, errLockBusy) {
			return nil, fmt.Errorf("%w：%s", ErrLocked, dir)
		}
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			unlock(f)
			f.Close()
		})
	}, nil
}
