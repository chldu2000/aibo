package shell_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// A file the details show can have its path copied, be opened, and be
// mentioned in the draft, from beside its name or its row's menu; once it
// is gone, only its path can be copied.
func TestPathActions(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "src"), 0o755)
	file := filepath.Join(root, "src", "file.txt")
	if err := os.WriteFile(file, []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(root)
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	var opened []string
	sh := shell.New(wb, shell.Options{Only: x.ID, OpenFile: func(p string) { opened = append(opened, p) }})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1300, 800)
	frame(tt)
	click(t, tt, "会话详情")
	click(t, tt, "工作区文件")
	waitText(t, tt, "src")

	// The row's menu.
	click(t, tt, "src")
	waitText(t, tt, "file.txt")
	if err := tt.RightClick("file.txt"); err != nil {
		t.Fatal(err)
	}
	if err := tt.ChooseMenuItem("复制相对路径"); err != nil {
		t.Fatalf("%v; the menu is %q", err, tt.Menu())
	}
	frame(tt)
	if got := tt.Clipboard(); got != "src/file.txt" {
		t.Errorf("the menu copied %q", got)
	}
	tt.SetClipboard("")

	// Beside the file's name.
	click(t, tt, "file.txt")
	waitText(t, tt, "复制相对路径")
	click(t, tt, "复制相对路径")
	if got := tt.Clipboard(); got != "src/file.txt" {
		t.Errorf("copied %q", got)
	}
	click(t, tt, "用默认程序打开")
	if len(opened) != 1 || opened[0] != file {
		t.Errorf("opened %q, want %q", opened, file)
	}
	click(t, tt, "提及到输入框")
	if !tt.HasText(locales.RemoveFile("src/file.txt")) {
		t.Errorf("no mention in the draft: %q", tt.Texts())
	}
	if !tt.Focused("给 假 Agent 发消息") {
		t.Error("the composer does not have the focus")
	}

	// Gone, it cannot be opened.
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	click(t, tt, "刷新工作区")
	frame(tt)
	click(t, tt, "用默认程序打开")
	if len(opened) != 1 {
		t.Errorf("a gone file opened: %q", opened)
	}
	click(t, tt, "复制相对路径")
	if got := tt.Clipboard(); got != "src/file.txt" {
		t.Errorf("a gone file's path copied %q", got)
	}
}
