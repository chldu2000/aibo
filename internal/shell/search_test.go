package shell_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// waitText runs frames until the window shows text: for what comes from
// off the main thread, as a search's results.
func waitText(t *testing.T, tt *ui.Tester, text string) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for !tt.HasText(text) {
		if time.Now().After(deadline) {
			t.Fatalf("missing %q: %q", text, tt.Texts())
		}
		time.Sleep(5 * time.Millisecond)
		tt.Frame()
		tt.Advance(50 * time.Millisecond)
	}
}

// The sidebar searches once the query rests, shows the last results
// until the next come, searches again when sessions change, and shows at
// most 50.
func TestSidebarSearch(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, err := wb.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Not the session open, whose title the header shows.
	odd, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(odd.ID, "haystack")
	for i := range 52 {
		x, _ := wb.NewSession(ws.ID, fake.Kind, "")
		wb.Rename(x.ID, fmt.Sprintf("needle %02d", i))
	}

	sh := shell.New(wb, shell.Options{})
	tt := ui.NewTester(sh.View, 1100, 900)
	tt.Frame()
	if err := tt.Click("搜索会话"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()

	// Typed, it is not searched for until it rests.
	tt.Type("hay")
	tt.Frame()
	tt.Advance(50 * time.Millisecond)
	tt.Frame()
	if !tt.HasText("正在搜索…") || tt.HasText("haystack") || tt.HasText("没有找到会话") {
		t.Fatalf("before the query rests: %q", tt.Texts())
	}
	waitText(t, tt, "haystack")
	if tt.HasText("正在搜索…") {
		t.Errorf("still searching: %q", tt.Texts())
	}

	// A session renamed is found without typing again.
	wb.Rename(odd.ID, "haystack moved")
	waitText(t, tt, "haystack moved")

	// The results of the last query show while the next is searched for.
	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("needle")
	tt.Frame()
	if !tt.HasText("haystack moved") {
		t.Errorf("the last results went before the next came: %q", tt.Texts())
	}
	waitText(t, tt, "还有 2 个会话没有显示，换个更具体的词再搜。")
	if tt.HasText("haystack moved") {
		t.Errorf("the last results stayed: %q", tt.Texts())
	}

	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("nothing like it")
	waitText(t, tt, "没有找到会话")
}
