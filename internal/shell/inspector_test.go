package shell_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

func TestInspectorFileSelectionFollowsWorkspace(t *testing.T) {
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "file.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	ws, _ := w.AddWorkspace(root)
	first, _ := w.NewSession(ws.ID, fake.Kind, "")
	second, _ := w.NewSession(ws.ID, fake.Kind, "")
	other, _ := w.AddWorkspace(t.TempDir())
	third, _ := w.NewSession(other.ID, fake.Kind, "")
	sh := shell.New(w, shell.Options{})
	defer sh.Close()
	sh.Open(first.ID)
	tt := ui.NewTester(sh.View, 850, 650)
	wait := func(label string) {
		t.Helper()
		for until := time.Now().Add(3 * time.Second); time.Now().Before(until); {
			tt.Frame()
			if tt.HasText(label) {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatalf("missing %s: %q", label, tt.Texts())
	}
	click := func(label string) {
		t.Helper()
		wait(label)
		if err := tt.Click(label); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
	}
	click("会话详情")
	click("工作区文件")
	click("src")
	click("file.txt")
	wait("src/file.txt")
	sh.Open(second.ID)
	wait("src/file.txt")
	sh.Open(third.ID)
	wait("目录为空")
	if tt.HasText("src/file.txt") {
		t.Fatal("previous workspace preview still visible")
	}
	sh.Open(first.ID)
	wait("src/file.txt")
	click("返回")
	wait("file.txt")
	if out, err := exec.Command("git", "-C", root, "init", "-b", "sidebar-test").CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	// The open panel read the Git status for its tab's count before the
	// repository was made; a refresh reads it again.
	click("刷新工作区")
	click("Git 状态")
	wait("sidebar-test · 尚无提交")
	wait("?  src/file.txt")
	click("?  src/file.txt")
	wait("未跟踪")
	wait("src/file.txt")
	sh.Open(second.ID)
	wait("src/file.txt")
	if err := os.Remove(filepath.Join(root, "src", "file.txt")); err != nil {
		t.Fatal(err)
	}
	click("刷新工作区")
	wait("选中的改动已消失")
	click("返回")
	wait("工作树干净")
	sh.Open(third.ID)
	wait("此目录不属于 Git 仓库")
}

func TestInspectorBesideConversationAndAboveNarrowDraft(t *testing.T) {
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	ws, _ := w.AddWorkspace(t.TempDir())
	x, _ := w.NewSession(ws.ID, fake.Kind, "")
	main := shell.New(w, shell.Options{})
	defer main.Close()
	detached := shell.New(w, shell.Options{Only: x.ID})
	defer detached.Close()
	wide := ui.NewTester(main.View, 1100, 800)
	narrow := ui.NewTester(detached.View, 440, 520)
	click := func(tt *ui.Tester, name string) {
		t.Helper()
		if err := tt.Click(name); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
		tt.Frame()
	}
	find := func(tt *ui.Tester, name string) ui.Rect {
		t.Helper()
		r, ok := tt.Find(name)
		if !ok {
			t.Fatalf("missing %s", name)
		}
		return r
	}
	prompt := "给 假 Agent 发消息"
	click(wide, "会话详情")
	composer, detail := find(wide, prompt), find(wide, "原生会话")
	if composer.X+composer.W > detail.X {
		t.Fatalf("wide detail overlaps composer: %v %v", composer, detail)
	}
	if narrow.HasText("关闭会话详情") {
		t.Fatal("opening one window's inspector opened another")
	}
	click(narrow, prompt)
	narrow.Type("draft")
	click(narrow, "会话详情")
	composer, detail = find(narrow, prompt), find(narrow, "关闭会话详情")
	if detail.Y+detail.H >= composer.Y {
		t.Fatalf("narrow inspector covers draft: %v %v", composer, detail)
	}
	click(narrow, "关闭会话详情")
	narrow.Type(" restored")
	narrow.Frame()
	field, ok := narrow.Access(prompt)
	if !ok || field.Value != "draft restored" || !wide.HasText("关闭会话详情") {
		t.Fatalf("focus, draft or other inspector lost: %q", field.Value)
	}
}

// Esc and ⌘[ leave what a page opened; Esc on a page closes the panel.
func TestInspectorKeys(t *testing.T) {
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	ws, _ := w.AddWorkspace(root)
	x, _ := w.NewSession(ws.ID, fake.Kind, "")
	sh := shell.New(w, shell.Options{})
	defer sh.Close()
	sh.Open(x.ID)
	tt := ui.NewTester(sh.View, 850, 650)
	wait := func(label string) {
		t.Helper()
		for until := time.Now().Add(3 * time.Second); time.Now().Before(until); {
			tt.Frame()
			if tt.HasText(label) {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatalf("missing %s: %q", label, tt.Texts())
	}
	click := func(label string) {
		t.Helper()
		wait(label)
		if err := tt.Click(label); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
	}
	click("会话详情")
	click("工作区文件")
	click("file.txt")
	wait("返回")
	tt.Key(ui.Super, ui.KeyBracketLeft)
	tt.Frame()
	if tt.HasText("返回") {
		t.Fatal("⌘[ did not leave the file")
	}
	click("file.txt")
	wait("返回")
	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if tt.HasText("返回") || !tt.HasText("关闭会话详情") {
		t.Fatalf("Esc did not go back to the files: %q", tt.Texts())
	}
	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if tt.HasText("关闭会话详情") {
		t.Fatal("Esc did not close the panel")
	}
}
