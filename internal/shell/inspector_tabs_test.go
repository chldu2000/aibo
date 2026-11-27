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

// The details' tabs count what is in them, the Git changes once the panel
// is open; the session's pages come first, and the panel says whose page
// it shows: the session's, or its workspace's.
func TestInspectorTabs(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("no git")
	}
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-b", "main").CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	for _, name := range []string{"a.txt", "b.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(root)
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(x.ID, "the session")
	sh := shell.New(wb, shell.Options{Only: x.ID})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 1300, 800)
	frame(tt)
	click(t, tt, "会话详情")
	waitText(t, tt, "工作区文件")

	// The session's pages, then the workspace's.
	left := float32(-1)
	for _, name := range []string{"概览", "命令记录", "子 Agent 活动", "工作区文件", "Git 状态"} {
		r, ok := tt.Find(name)
		if !ok || r.X <= left {
			t.Errorf("the tab %q is not next, at %v after %v", name, r.X, left)
		}
		left = r.X
	}

	// The Git tab counts the two files, in its corner; its name stays.
	git, ok := tt.Find("Git 状态")
	if !ok {
		t.Fatalf("no Git tab: %q", tt.Texts())
	}
	for end := time.Now().Add(4 * time.Second); ; {
		if r, ok := tt.Find("2"); ok && r.X >= git.X && r.X < git.X+git.W {
			break
		}
		if time.Now().After(end) {
			t.Fatalf("the Git tab does not count 2: %q", tt.Texts())
		}
		time.Sleep(10 * time.Millisecond)
		frame(tt)
	}
	if !tt.HasText("the session") {
		t.Errorf("the overview does not say whose: %q", tt.Texts())
	}

	click(t, tt, "Git 状态")
	if !tt.HasText("工作区 · " + filepath.Base(root)) {
		t.Errorf("the Git page does not say whose: %q", tt.Texts())
	}
}
