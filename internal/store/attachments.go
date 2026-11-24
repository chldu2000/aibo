package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// AttachmentsDir is the attachments' directory inside the data directory:
// a directory per session, a file per attachment.
const AttachmentsDir = "attachments"

// ErrBadAttachment is returned for an attachment's file name that is not
// one PutAttachment gives.
var ErrBadAttachment = errors.New("store: not an attachment's file name")

// PutAttachment keeps data as a new attachment of a session, with the
// extension ext (".png"), and returns its file name, relative to the
// attachments directory, as model.Attachment.File keeps it.
func (s *Store) PutAttachment(sessionID, ext string, data []byte) (string, error) {
	if !safeName(sessionID) || !safeName(strings.TrimPrefix(ext, ".")) {
		return "", ErrBadAttachment
	}
	dir := filepath.Join(s.dir, AttachmentsDir, sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	var id [12]byte
	rand.Read(id[:])
	name := hex.EncodeToString(id[:]) + ext
	tmp, err := os.CreateTemp(dir, ".put-*")
	if err != nil {
		return "", err
	}
	_, err = tmp.Write(data)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), filepath.Join(dir, name))
	}
	if err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return sessionID + "/" + name, nil
}

// AttachmentPath is where an attachment's file is, from its file name; ""
// when the name is not one PutAttachment gives.
func (s *Store) AttachmentPath(file string) string {
	session, name, ok := strings.Cut(file, "/")
	if !ok || !safeName(session) || !safeName(name) || path.Clean(file) != file {
		return ""
	}
	return filepath.Join(s.dir, AttachmentsDir, session, name)
}

// RemoveAttachment removes an attachment's file, as one the user took
// back before sending it.
func (s *Store) RemoveAttachment(file string) error {
	p := s.AttachmentPath(file)
	if p == "" {
		return ErrBadAttachment
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s *Store) removeAttachments(sessionID string) error {
	if !safeName(sessionID) {
		return nil
	}
	return os.RemoveAll(filepath.Join(s.dir, AttachmentsDir, sessionID))
}

// safeName is a single path element without separators or dots only.
func safeName(n string) bool {
	return n != "" && n != "." && n != ".." && !strings.ContainsAny(n, `/\`+"\x00")
}
