package shell_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// A call that changes files says which and by how many lines; open, it
// shows each file's diff under its path, which opens the file, and not
// the result that only says it went well. A group counts the files.
func TestFileChangeCalls(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\nTWO\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	a, b, gone := filepath.Join(dir, "a.txt"), filepath.Join(dir, "b.txt"), filepath.Join(dir, "c.txt")
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "e", Name: "Edit", Input: json.RawMessage(`{"file_path":"a.txt"}`)})
		emit(agent.ToolFinished{ToolID: "e", Output: "The file has been updated successfully.", Changes: []agent.FileChange{
			{Path: a, Kind: agent.FileModified, Patch: agent.PatchHunks(a, "@@ -1,2 +1,2 @@\n one\n-two\n+TWO")},
		}})
		emit(agent.ToolStarted{ToolID: "p", Name: "apply_patch", Input: json.RawMessage(`{}`), Changes: []agent.FileChange{
			{Path: b, Kind: agent.FileAdded, Patch: agent.PatchAdded(b, "new\n")},
			{Path: gone, Kind: agent.FileDeleted, Patch: agent.PatchDeleted(gone, "old\n")},
		}})
		emit(agent.ToolFinished{ToolID: "p", Output: "patched"})
		emit(agent.ReplyDelta{ReplyID: "r", Text: "edited"})
		emit(agent.ReplyDone{ReplyID: "r"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(dir)
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "edit")
	for wb.Status(s.ID).Running {
		<-changes
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 1100, 900)
	frame(tt)

	group := startingWith(tt, "2 个工具调用")
	if group != "2 个工具调用 · 改了 3 个文件" {
		t.Errorf("the group says %q", group)
	}
	click(t, tt, group)
	click(t, tt, "a.txt +1 −1")
	if !tt.HasText("在文件页打开 a.txt") {
		t.Fatalf("the edit shows no path: %q", tt.Texts())
	}
	if tt.HasText("updated successfully") {
		t.Errorf("the edit shows its result: %q", tt.Texts())
	}
	click(t, tt, "a.txt +1 −1")

	click(t, tt, "2 个文件 +1 −1")
	for _, want := range []string{"在文件页打开 b.txt", "新建", "c.txt", "删除"} {
		if !tt.HasText(want) {
			t.Errorf("the patch lacks %q: %q", want, tt.Texts())
		}
	}
	if tt.HasText("在文件页打开 c.txt") {
		t.Error("a file deleted opens")
	}
	// A file created deletes nothing, a file deleted adds nothing.
	if _, ok := tt.Find("−0"); ok {
		t.Errorf("a side of none shows: %q", tt.Texts())
	}
	if _, ok := tt.Find("+0"); ok {
		t.Errorf("a side of none shows: %q", tt.Texts())
	}
	click(t, tt, "2 个文件 +1 −1")

	click(t, tt, "a.txt +1 −1")
	click(t, tt, "在文件页打开 a.txt")
	// The file's actions show by its name.
	waitText(t, tt, "复制相对路径")
}
