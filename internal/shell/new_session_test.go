package shell_test

import (
	"context"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// ⌘N starts a session in the open session's workspace, with its Agent;
// ⇧⌘N, and the button beside "New session", choose where and with which.
func TestNewSessionShortcut(t *testing.T) {
	quiet := func(context.Context, agent.StartOptions, agent.Turn, func(agent.Event)) {}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{
		named{fake.New(quiet), "alpha", "Alpha"}, named{fake.New(quiet), "beta", "Beta"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	one, _ := wb.AddWorkspace(t.TempDir())
	two, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(two.ID, "beta", "")
	wb.Rename(x.ID, "the open one")
	wb.NewSession(one.ID, "alpha", "")
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame(tt)
	click(t, tt, "the open one")

	before := map[string]bool{}
	for _, y := range wb.Sessions() {
		before[y.ID] = true
	}
	count := len(before)
	tt.Key(ui.Cmd, ui.KeyN)
	frame(tt)
	all := wb.Sessions()
	if len(all) != count+1 {
		t.Fatalf("⌘N made %d sessions", len(all)-count)
	}
	var newest model.Session
	for _, y := range all {
		if !before[y.ID] {
			newest = y
		}
	}
	if newest.WorkspaceID != two.ID || newest.Agent != "beta" {
		t.Errorf("⌘N made a %s session in %s, want beta in %s", newest.Agent, newest.WorkspaceID, two.ID)
	}
	if !tt.Focused("给 Beta 发消息") {
		t.Errorf("the new session's composer does not have the focus")
	}

	// ⇧⌘N asks, each workspace with its Agents.
	tt.Key(ui.Cmd|ui.Shift, ui.KeyN)
	frame(tt)
	choice := "在 " + filepath.Base(one.Path) + " 用 Alpha 新建"
	if !tt.HasText(choice) || !tt.HasText("在 "+filepath.Base(two.Path)+" 用 Beta 新建") {
		t.Fatalf("no choices: %q", tt.Texts())
	}
	click(t, tt, choice)
	all = wb.Sessions()
	if len(all) != count+2 {
		t.Fatalf("choosing made %d sessions", len(all)-count-1)
	}
	if tt.HasText(choice) {
		t.Error("the choices stay")
	}
	keys := "Ctrl+Shift+N"
	if runtime.GOOS == "darwin" {
		keys = "⇧⌘N"
	}
	click(t, tt, "选择工作区和 Agent 新建（"+keys+"）")
	if !tt.HasText(choice) {
		t.Errorf("the button does not ask: %q", tt.Texts())
	}
}

// An Agent that cannot start a session now is not started with: ⌘N asks,
// and says why.
func TestNewSessionUnusable(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	wb.NewSession(ws.ID, fake.Kind, "")
	// A registry that knows nothing of the fake Agent.
	tt := ui.NewTester(shell.New(wb, shell.Options{Agents: agents.New(agents.Options{})}).View, 1100, 800)
	frame(tt)
	count := len(wb.Sessions())
	tt.Key(ui.Cmd, ui.KeyN)
	frame(tt)
	if n := len(wb.Sessions()); n != count {
		t.Errorf("⌘N made %d sessions with an Agent that cannot", n-count)
	}
	if !tt.HasText("现在不能新建会话") {
		t.Errorf("⌘N does not ask, or say why: %q", tt.Texts())
	}
}
