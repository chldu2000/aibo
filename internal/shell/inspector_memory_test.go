package shell_test

import (
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// The details panel opens on the page it last showed, in this launch and
// the next; ⌥⌘I opens and closes it, and ⌘1 to ⌘5 open it on a page.
func TestInspectorRemembersPage(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	launch := func() *ui.Tester {
		sh := shell.New(wb, shell.Options{})
		t.Cleanup(sh.Close)
		sh.Open(x.ID)
		tt := ui.NewTester(sh.View, 1100, 800)
		frame(tt)
		return tt
	}
	const opener, closer = "会话详情", "关闭会话详情"
	overview, commands := locales.DetailNative(), locales.NoActivities()
	shows := func(tt *ui.Tester, label, when string) {
		t.Helper()
		if !tt.HasText(label) {
			t.Fatalf("%s, no %q: %q", when, label, tt.Texts())
		}
	}
	lacks := func(tt *ui.Tester, label, when string) {
		t.Helper()
		if tt.HasText(label) {
			t.Fatalf("%s, %q shows: %q", when, label, tt.Texts())
		}
	}

	tt := launch()
	click(t, tt, opener)
	shows(tt, overview, "first opened")
	click(t, tt, locales.CommandHistory())
	shows(tt, commands, "on the commands' page")
	click(t, tt, closer)
	click(t, tt, opener)
	shows(tt, commands, "opened again")
	lacks(tt, overview, "opened again")

	// The next launch opens on it too.
	tt = launch()
	lacks(tt, closer, "launched")
	click(t, tt, opener)
	shows(tt, commands, "opened in the next launch")

	// ⌥⌘I closes and opens it.
	tt.Key(ui.Cmd|ui.Alt, ui.KeyI)
	frame(tt)
	lacks(tt, closer, "after ⌥⌘I")
	tt.Key(ui.Cmd|ui.Alt, ui.KeyI)
	frame(tt)
	shows(tt, commands, "after ⌥⌘I again")

	// ⌘1 turns it to the overview; closed, ⌘2 opens it on the commands.
	tt.Key(ui.Cmd, ui.Key1)
	frame(tt)
	shows(tt, overview, "after ⌘1")
	click(t, tt, closer)
	tt.Key(ui.Cmd, ui.Key2)
	frame(tt)
	shows(tt, closer, "after ⌘2")
	shows(tt, commands, "after ⌘2")
}
