package store

import "database/sql"

// OpenVersion makes a database of schema version v in dir, as an older
// aibo left it.
func OpenVersion(dir string, v int) error {
	db, err := sql.Open("sqlite", "file:"+dir+"/"+DBFile)
	if err != nil {
		return err
	}
	defer db.Close()
	return (&Store{db: db}).migrateTo(v)
}
