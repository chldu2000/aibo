package workbench_test

import (
	"bytes"
	"errors"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// An attached image is kept, goes to the Agent as a file to see, stays
// with the message, and goes with its session.
func TestAttachImage(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, s := newSession(t, b)

	a, err := b.AttachImage(s.ID, "/Users/me/Desktop/shot.jpeg", pngOf(t, 4, 3))
	if err != nil {
		t.Fatal(err)
	}
	if a.Name != "shot.png" || a.MIME != "image/png" || a.Width != 4 || a.Height != 3 {
		t.Errorf("attached %+v", a)
	}
	path := b.AttachmentPath(a)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the copy is not at %q: %v", path, err)
	}
	if pasted, _ := b.AttachImage(s.ID, "", pngOf(t, 1, 1)); pasted.Name != "image.png" {
		t.Errorf("a pasted image is named %q", pasted.Name)
	}
	if _, err := b.AttachImage(s.ID, "notes.txt", []byte("hello")); !errors.Is(err, workbench.ErrNotImage) {
		t.Errorf("text → %v", err)
	}

	// An image alone is a message.
	if err := b.SendMessage(s.ID, workbench.Outgoing{Attachments: []model.Attachment{a}}); err != nil {
		t.Fatal(err)
	}
	sc.endTurn()
	b.idle(t, s.ID)
	turns, _ := sc.received()
	if got := turns[len(turns)-1].Images; !reflect.DeepEqual(got, []agent.Image{{Path: path, MIME: "image/png"}}) {
		t.Errorf("the Agent got %+v", got)
	}
	ms := b.messages(t, s.ID)
	if got := ms[len(ms)-1]; got.Kind != model.UserMessage || !reflect.DeepEqual(got.Attachments, []model.Attachment{a}) {
		t.Errorf("the message keeps %+v", got.Attachments)
	}

	// Discarding one sent keeps it; one not sent goes.
	b.DiscardAttachment(a)
	if _, err := os.Stat(path); err != nil {
		t.Error("discarding removed a sent image")
	}
	other, _ := b.AttachImage(s.ID, "", pngOf(t, 2, 2))
	b.DiscardAttachment(other)
	if _, err := os.Stat(b.AttachmentPath(other)); !os.IsNotExist(err) {
		t.Error("a discarded image stayed")
	}
	if err := b.SendMessage(s.ID, workbench.Outgoing{Text: "再看", Attachments: []model.Attachment{other}}); !errors.Is(err, workbench.ErrAttachmentGone) {
		t.Errorf("a discarded image sent: %v", err)
	}

	// Another session's attachment is not this one's.
	s2, _ := b.NewSession(ws.ID, fake.Kind, "")
	if err := b.SendMessage(s2.ID, workbench.Outgoing{Attachments: []model.Attachment{a}}); !errors.Is(err, workbench.ErrAttachmentGone) {
		t.Errorf("another session's image sent: %v", err)
	}

	// Another session referencing it reads, and finds, the image's name.
	r, err := b.ReferenceSession(s.ID, s2.ID)
	if err != nil {
		t.Fatal(err)
	}
	converse(t, b, sc, s2.ID, "读")
	_, opts := lastTurn(sc)
	if text, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID}); !strings.Contains(text, "[图片: shot.png]") {
		t.Errorf("read_reference → %s", text)
	}
	if text, _ := call(t, opts, "search_reference", map[string]any{"query": "shot.png"}); !strings.Contains(text, r.ID) {
		t.Errorf("search_reference → %s", text)
	}

	if err := b.DeleteSession(s.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("the image outlived its session")
	}
}

// A path pasted or dropped is a mention when the session may read it.
func TestMentionPath(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	ws, s := newSession(t, b)
	touch(t, ws.Path, "docs/a.md")
	h, err := b.MentionPath(s.ID, filepath.Join(ws.Path, "docs", "a.md"))
	if err != nil || h.Rel != "docs/a.md" || h.Mention.WorkspaceID != ws.ID || h.Mention.Dir {
		t.Errorf("a.md → %+v, %v", h, err)
	}
	if d, err := b.MentionPath(s.ID, filepath.Join(ws.Path, "docs")); err != nil || !d.Mention.Dir || d.Rel != "docs/" {
		t.Errorf("docs → %+v, %v", d, err)
	}
	if _, err := b.MentionPath(s.ID, t.TempDir()); !errors.Is(err, workbench.ErrNotReadable) {
		t.Errorf("outside → %v", err)
	}
}

// A file given by its path is attached when an image, whatever its name,
// and mentioned otherwise.
func TestAttachPath(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	ws, s := newSession(t, b)
	outside := t.TempDir()
	shot := filepath.Join(outside, "Screenshot 2026-11-24.png")
	os.WriteFile(shot, pngOf(t, 3, 2), 0o644)
	g, err := b.AttachPath(s.ID, shot)
	if err != nil || g.Attachment == nil || g.Attachment.Name != "Screenshot 2026-11-24.png" || g.Mention != nil {
		t.Errorf("a screenshot outside → %+v, %v", g, err)
	}
	touch(t, ws.Path, "notes.md")
	if g, err := b.AttachPath(s.ID, filepath.Join(ws.Path, "notes.md")); err != nil || g.Mention == nil || g.Mention.Rel != "notes.md" {
		t.Errorf("a file inside → %+v, %v", g, err)
	}
	os.WriteFile(filepath.Join(outside, "a.pdf"), []byte("%PDF-1.7"), 0o644)
	if _, err := b.AttachPath(s.ID, filepath.Join(outside, "a.pdf")); !errors.Is(err, workbench.ErrNotReadable) {
		t.Errorf("a PDF outside → %v", err)
	}
}
