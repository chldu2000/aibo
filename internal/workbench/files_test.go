package workbench_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func touch(t *testing.T, root string, paths ...string) {
	t.Helper()
	for _, p := range paths {
		full := filepath.Join(root, p)
		os.MkdirAll(filepath.Dir(full), 0o755)
		os.WriteFile(full, []byte("x"), 0o644)
	}
}

// The user mentions files of the session's workspace, and of the source
// workspaces it may read; the Agent gets their paths, relative in its own
// workspace, absolute in another, and the message keeps them.
func TestFileMentions(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	home, tgt := newSession(t, b)
	touch(t, home.Path, "src/main.go", "docs/guide.md")
	other, _ := b.AddWorkspace(t.TempDir())
	touch(t, other.Path, "lib/util.go")
	far, _ := b.NewSession(other.ID, fake.Kind, "")
	converse(t, b, sc, far.ID, "另一个工作区的讨论", "好")

	ctx := context.Background()
	hits, err := b.MatchFiles(ctx, tgt.ID, "main", 10)
	if err != nil || len(hits) != 1 || hits[0].Rel != "src/main.go" || hits[0].Mention.WorkspaceID != home.ID {
		t.Fatalf("main → %+v, %v", hits, err)
	}
	// Not readable yet: the other workspace is not listed.
	if hits, _ := b.MatchFiles(ctx, tgt.ID, "util", 10); len(hits) != 0 {
		t.Errorf("util before a reference → %+v", hits)
	}
	b.ReferenceSession(far.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "读")
	hits, _ = b.MatchFiles(ctx, tgt.ID, "util", 10)
	if len(hits) != 1 || hits[0].Workspace != other.Path || hits[0].Mention.Path != filepath.Join(other.Path, "lib/util.go") {
		t.Fatalf("util → %+v", hits)
	}
	dir, _ := b.MatchFiles(ctx, tgt.ID, "docs", 10)
	if len(dir) == 0 || !dir[0].Mention.Dir || dir[0].Rel != "docs/" {
		t.Fatalf("docs → %+v", dir)
	}

	mentions := []model.Mention{dir[0].Mention, hits[0].Mention, {Path: filepath.Join(home.Path, "src/main.go"), WorkspaceID: home.ID}}
	if err := b.SendWithFiles(tgt.ID, "看看这些", mentions); err != nil {
		t.Fatal(err)
	}
	sc.endTurn()
	b.idle(t, tgt.ID)
	turns, _ := sc.received()
	want := []agent.FileMention{
		{Path: filepath.Join(home.Path, "docs") + "/", Rel: "docs/", Dir: true},
		{Path: filepath.Join(other.Path, "lib/util.go")},
		{Path: filepath.Join(home.Path, "src/main.go"), Rel: "src/main.go"},
	}
	if last := turns[len(turns)-1]; last.Text != "看看这些" || !reflect.DeepEqual(last.Files, want) {
		t.Errorf("the Agent got %q %+v", last.Text, last.Files)
	}
	ms := b.messages(t, tgt.ID)
	var sent model.Message
	for _, m := range ms {
		if m.Kind == model.UserMessage {
			sent = m
		}
	}
	if !reflect.DeepEqual(sent.Mentions, mentions) {
		t.Errorf("the message keeps %+v", sent.Mentions)
	}
	// Only mentions, no words: fine. A file it may not read: refused.
	if err := b.SendWithFiles(tgt.ID, "", mentions[2:]); err != nil {
		t.Errorf("mentions alone: %v", err)
	}
	sc.endTurn()
	b.idle(t, tgt.ID)
	if err := b.SendWithFiles(tgt.ID, "这个呢", []model.Mention{{Path: "/etc/hosts"}}); !errors.Is(err, workbench.ErrNotReadable) {
		t.Errorf("a file outside: %v", err)
	}
}
