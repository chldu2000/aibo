package shell_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

func TestReferencePanelPlacement(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	source, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(source.ID, "引用来源")
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	for _, size := range []struct {
		name string
		only string
		w, h int
	}{{"main", "", 1100, 800}, {"detached", x.ID, 440, 520}} {
		t.Run(size.name, func(t *testing.T) {
			sh := shell.New(wb, shell.Options{Only: size.only})
			defer sh.Close()
			sh.Open(x.ID)
			tt := ui.NewTester(sh.View, size.w, size.h)
			tt.Frame()
			click := func(label string) {
				t.Helper()
				if err := tt.Click(label); err != nil {
					t.Fatal(err)
				}
				tt.Frame()
			}
			aboveDraft := func() {
				t.Helper()
				panel, ok := tt.AccessByRole(ui.RolePopup, "")
				if !ok {
					t.Fatal("missing reference popover")
				}
				input, ok := tt.Find("给 假 Agent 发消息")
				if !ok {
					t.Fatal("composer inaccessible while picking a reference")
				}
				b := panel.Bounds
				gap := input.Y - (b.Y + b.H)
				if gap < 0 || gap > 26 || b.X > input.X || b.X < input.X-18 || b.X+b.W > float32(size.w) || b.Y < 0 || b.H < 100 {
					t.Fatalf("panel %v, composer %v", b, input)
				}
			}
			click("给 假 Agent 发消息")
			tt.Type("第一行\n第二行")
			tt.Frame()
			click("引用文件或会话（@）")
			aboveDraft()
			click("选择 引用来源")
			aboveDraft()
			if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
				saveImage(t, tt.Image(), filepath.Join(p, "reference-range-"+size.name+".png"))
			}
			click("会话详情")
			if !tt.HasText("关闭会话详情") || tt.HasText("插入引用") {
				t.Fatal("click outside should dismiss the reference panel and open details")
			}
		})
	}
}

// "@" and a few letters find a file of the workspace, which goes into the
// draft as a chip in place of the "@"; sent, the Agent gets its path, and
// the message shows it. The same panel still lists sessions.
func TestMentionFile(t *testing.T) {
	var mu sync.Mutex
	var got []agent.Turn
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		mu.Lock()
		got = append(got, turn)
		mu.Unlock()
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "internal/shell"), 0o755)
	os.WriteFile(filepath.Join(root, "internal/shell/pull.go"), []byte("package shell"), 0o644)
	os.WriteFile(filepath.Join(root, "README.md"), []byte("# x"), 0o644)
	ws, _ := wb.AddWorkspace(root)
	other, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(other.ID, "pull 的讨论")
	wb.NewSession(ws.ID, fake.Kind, "") // the newest: open
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
			time.Sleep(5 * time.Millisecond) // the files match off the main thread
		}
	}
	frame()
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}
	until := func(s string) {
		t.Helper()
		for i := 0; i < 100 && !tt.HasText(s); i++ {
			frame()
		}
		if !tt.HasText(s) {
			t.Fatalf("never %q: %q", s, tt.Texts())
		}
	}

	click("给 假 Agent 发消息")
	tt.Type("看看 ")
	frame()
	tt.Type("@")
	frame()
	tt.Type("pull")
	until("选择文件 internal/shell/pull.go")
	for i := 0; i < 100 && tt.HasText("选择文件 README.md"); i++ {
		frame() // the matches of "pull" replace those of ""
	}
	if tt.HasText("选择文件 README.md") {
		t.Fatalf("not filtered: %q", tt.Texts())
	}
	if !tt.HasText("选择 pull 的讨论") {
		t.Errorf("the panel lists no session: %q", tt.Texts())
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "07-panel.png"))
	}
	click("选择文件 internal/shell/pull.go")
	if tt.HasText("搜索文件或会话") {
		t.Fatal("the panel stayed open")
	}
	if _, ok := tt.Find("移除文件 internal/shell/pull.go"); !ok {
		t.Fatalf("no chip in the composer: %q", tt.Texts())
	}

	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "07-chip.png"))
	}
	tt.Key(0, ui.KeyEnter)
	for i := 0; i < 100; i++ {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		frame()
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0].Text != "看看" || len(got[0].Files) != 1 || got[0].Files[0].Rel != "internal/shell/pull.go" {
		t.Fatalf("the Agent got %+v", got)
	}
	frame()
	if _, ok := tt.Find("移除文件 internal/shell/pull.go"); ok {
		t.Error("the chip stayed in the composer")
	}
	if !tt.HasText("internal/shell/pull.go") {
		t.Errorf("the message does not show the file: %q", tt.Texts())
	}
}
