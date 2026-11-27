package shell_test

import (
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// The header has three buttons: to quote, "…" and the details. "…" is
// the session row's own menu, and does what it does.
func TestHeaderMenu(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(x.ID, "the session")
	tt := ui.NewTester(shell.New(wb, shell.Options{OpenWindow: func(string) {}}).View, 1100, 800)
	frame(tt)
	click(t, tt, "the session")

	// The header's buttons: in its band, right of the sidebar.
	search, _ := tt.Find("搜索会话")
	var buttons []string
	for _, a := range tt.AccessAll() {
		control := a.Role == ui.RoleGroup || a.Role == ui.RoleButton || a.Role == ui.RolePopUpButton || a.Role == ui.RoleMenuButton
		if control && a.Name != "" && a.Bounds.Y < 60 && a.Bounds.X > search.X+search.W+20 {
			buttons = append(buttons, a.Name)
		}
	}
	if got, want := strings.Join(buttons, "|"), "选择消息以引用或复制|会话的更多操作|会话详情"; got != want {
		t.Errorf("the header's buttons are %q, want %q", got, want)
	}

	header := func() []string {
		t.Helper()
		click(t, tt, "会话的更多操作")
		return tt.Menu()
	}
	row := func() []string {
		t.Helper()
		if err := tt.RightClick("the session"); err != nil {
			t.Fatal(err)
		}
		return tt.Menu()
	}
	h := header()
	tt.Key(0, ui.KeyEscape)
	frame(tt)
	if r := row(); strings.Join(h, "|") != strings.Join(r, "|") {
		t.Errorf("the header's menu %q is not the row's %q", h, r)
	}
	tt.Key(0, ui.KeyEscape)
	frame(tt)

	header()
	if err := tt.ChooseMenuItem("重命名…"); err != nil {
		t.Fatal(err)
	}
	frame(tt)
	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("renamed")
	click(t, tt, "确定")
	if x, _ := wb.Session(x.ID); x.Title != "renamed" {
		t.Errorf("title = %q", x.Title)
	}

	header()
	if err := tt.ChooseMenuItem("删除…"); err != nil {
		t.Fatal(err)
	}
	frame(tt)
	click(t, tt, "确定删除")
	if _, ok := wb.Session(x.ID); ok {
		t.Error("not deleted")
	}
}
