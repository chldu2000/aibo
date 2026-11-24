package store_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/store"
)

// An attachment is a file of its session's own, kept with the message
// that carried it, and deleted with the session.
func TestAttachments(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	st.AddWorkspace(model.Workspace{ID: "w", Path: "/w"})
	st.CreateSession(model.Session{ID: "s", WorkspaceID: "w", Agent: "fake", CreatedAt: time.Now()})

	file, err := st.PutAttachment("s", ".png", []byte("png"))
	if err != nil {
		t.Fatal(err)
	}
	p := st.AttachmentPath(file)
	if b, _ := os.ReadFile(p); string(b) != "png" || filepath.Dir(p) != filepath.Join(dir, store.AttachmentsDir, "s") {
		t.Fatalf("%s at %s holds %q", file, p, b)
	}
	a := model.Attachment{Name: "shot.png", File: file, MIME: "image/png", Width: 2, Height: 1, Size: 3}
	if _, err := st.AppendMessage("s", model.Message{Kind: model.UserMessage, State: model.Done, Attachments: []model.Attachment{a}}); err != nil {
		t.Fatal(err)
	}
	ms, _ := st.Messages("s")
	if len(ms) != 1 || len(ms[0].Attachments) != 1 || ms[0].Attachments[0] != a {
		t.Fatalf("kept %+v", ms)
	}

	for _, bad := range []string{"../aibo.db", "s/../../aibo.db", "s", "/etc/passwd", "s/a/b"} {
		if st.AttachmentPath(bad) != "" {
			t.Errorf("%q has a path", bad)
		}
	}
	if _, err := st.PutAttachment("../x", ".png", nil); err == nil {
		t.Error("a session ID that leaves the directory was taken")
	}

	other, _ := st.PutAttachment("s", ".png", []byte("x"))
	if err := st.RemoveAttachment(other); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(st.AttachmentPath(other)); !os.IsNotExist(err) {
		t.Error("a removed attachment stayed")
	}

	if err := st.DeleteSession("s"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, store.AttachmentsDir, "s")); !os.IsNotExist(err) {
		t.Error("the attachments outlived their session")
	}
}
