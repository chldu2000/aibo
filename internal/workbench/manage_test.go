package workbench_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestRemoveWorkspaceArchivesItsSessions(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "要保留的讨论", "好")
	other, _ := b.AddWorkspace(t.TempDir())
	tgt, _ := b.NewSession(other.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(src.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "读")

	if err := b.RemoveWorkspace(ws.ID); err != nil {
		t.Fatal(err)
	}
	if got := b.Workspaces(); len(got) != 1 || got[0].ID != other.ID {
		t.Errorf("workspaces = %+v", got)
	}
	if x, _ := b.Session(src.ID); !x.Archived {
		t.Error("the session was not archived")
	}
	// Its data is kept: the reference to it still reads.
	_, opts := lastTurn(sc)
	if text, isErr := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID}); isErr || !strings.Contains(text, "要保留的讨论") {
		t.Errorf("read after removing its workspace: %q", text)
	}
	b.Close()

	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	if got := b2.Workspaces(); len(got) != 1 {
		t.Errorf("after restart: %+v", got)
	}
	// Added again, it comes back as it was.
	again, err := b2.AddWorkspace(ws.Path)
	if err != nil || again.ID != ws.ID {
		t.Fatalf("added again: %+v, %v", again, err)
	}
	if x, _ := b2.Session(src.ID); !x.Archived {
		t.Error("its sessions came back unarchived")
	}
	b2.RemoveWorkspace(ws.ID)
	// Unarchiving a session of a removed workspace brings both back.
	b2.SetArchived(src.ID, false)
	if got := b2.Workspaces(); len(got) != 2 {
		t.Errorf("workspaces after unarchiving = %+v", got)
	}
}

func TestMissingWorkspaceAndRelocate(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	root := t.TempDir()
	proj := filepath.Join(root, "proj")
	os.Mkdir(proj, 0o755)
	ws, _ := b.AddWorkspace(proj)
	s, _ := b.NewSession(ws.ID, fake.Kind, "")
	converse(t, b, sc, s.ID, "旧位置的讨论", "好")

	moved := filepath.Join(root, "moved")
	os.Rename(proj, moved)
	b.CheckWorkspaces()
	if got, _ := b.Workspace(ws.ID); !got.Missing {
		t.Fatal("the missing folder was not noticed")
	}
	if err := b.Send(s.ID, "继续"); !errors.Is(err, workbench.ErrWorkspaceMissing) {
		t.Errorf("send: %v", err)
	}
	if ms := b.messages(t, s.ID); len(ms) != 2 {
		t.Errorf("messages = %d", len(ms))
	}
	other, _ := b.AddWorkspace(t.TempDir())
	if err := b.Relocate(ws.ID, other.Path); !errors.Is(err, workbench.ErrPathInUse) {
		t.Errorf("relocating onto another workspace: %v", err)
	}
	if err := b.Relocate(ws.ID, moved); err != nil {
		t.Fatal(err)
	}
	if got, _ := b.Workspace(ws.ID); got.Missing || got.Path != moved {
		t.Errorf("after relocating: %+v", got)
	}
	converse(t, b, sc, s.ID, "继续")
	starts := b.fake.Starts()
	if last := starts[len(starts)-1]; last.Workspace != moved || last.ResumeID == "" {
		t.Errorf("started at %q, resuming %q", last.Workspace, last.ResumeID)
	}
}

func TestRenameArchiveSearchAndReferenceCount(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, s := newSession(t, b)
	converse(t, b, sc, s.ID, "数据库迁移方案", "用 Postgres 的 timestamptz")
	other, _ := b.NewSession(ws.ID, fake.Kind, "")
	converse(t, b, sc, other.ID, "前端白屏排查", "PayPage 少了加载态")
	r, _ := b.ReferenceSession(s.ID, other.ID)

	if err := b.Rename(s.ID, "  迁移方案（定稿）  "); err != nil {
		t.Fatal(err)
	}
	if x, _ := b.Session(s.ID); x.Title != "迁移方案（定稿）" || !x.TitleManual {
		t.Errorf("renamed: %+v", x)
	}
	if got, _ := b.Reference(r.ID); got.SourceTitle != "数据库迁移方案" {
		t.Errorf("the reference took the new title: %q", got.SourceTitle)
	}
	b.Rename(s.ID, "")
	if x, _ := b.Session(s.ID); x.Title != "数据库迁移方案" || x.TitleManual {
		t.Errorf("back to the default title: %+v", x)
	}

	b.SetArchived(s.ID, true)
	if x, _ := b.Session(s.ID); !x.Archived {
		t.Error("not archived")
	}
	// Archived, it is still found, and referenced.
	found, _, _ := b.SearchSessions("TIMESTAMPTZ", 0)
	if len(found) != 1 || found[0].Session.ID != s.ID || !strings.Contains(found[0].Snippet, "timestamptz") {
		t.Errorf("search by text = %+v", found)
	}
	found, _, _ = b.SearchSessions("迁移", 0)
	if len(found) != 1 || found[0].Snippet != "" {
		t.Errorf("search by title = %+v", found)
	}
	if found, _, _ := b.SearchSessions("  ", 0); found != nil {
		t.Errorf("an empty search found %+v", found)
	}
	if _, err := b.ReferenceSession(s.ID, other.ID); err != nil {
		t.Errorf("referencing an archived session: %v", err)
	}
	if n := b.ReferencesTo(s.ID); n != 2 {
		t.Errorf("references to it = %d", n)
	}
	if n := b.ReferencesTo(other.ID); n != 0 {
		t.Errorf("references to the other = %d", n)
	}
}

func TestModels(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	// The fake tells no models.
	if ms, err := b.Models(context.Background(), fake.Kind); ms != nil || err != nil {
		t.Errorf("models = %v, %v", ms, err)
	}
}

// A search shows, for each session, its first message that holds the
// words, and at most as many sessions as asked, saying how many more.
func TestSearchLimitAndFirstMatch(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	ws, first := newSession(t, b)
	ids := []string{first.ID}
	for range 2 {
		x, err := b.NewSession(ws.ID, fake.Kind, "")
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, x.ID)
	}
	for i, id := range ids {
		converse(t, b, sc, id, "开场 "+string(rune('A'+i)))
		converse(t, b, sc, id, "先问 needle 一次", "再答 needle 一次")
	}

	found, more, err := b.SearchSessions("NEEDLE", 0)
	if err != nil || len(found) != 3 || more != 0 {
		t.Fatalf("all: %+v, %d more, %v", found, more, err)
	}
	for _, f := range found {
		if !strings.Contains(f.Snippet, "先问") {
			t.Errorf("snippet of %s = %q, not of the first match", f.Session.ID, f.Snippet)
		}
	}

	found, more, _ = b.SearchSessions("needle", 2)
	if len(found) != 2 || more != 1 {
		t.Fatalf("limited: %d found, %d more", len(found), more)
	}
	// The most recent first.
	if found[0].Session.ID != ids[2] || found[1].Session.ID != ids[1] {
		t.Errorf("order = %s, %s; want %s, %s", found[0].Session.ID, found[1].Session.ID, ids[2], ids[1])
	}
}
