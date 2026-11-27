package shell_test

import (
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// The details beside the messages take the width their edge is dragged
// to, within 300 and what leaves the messages 360, kept for the next
// launch; a double click puts back 400.
func TestInspectorWidth(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	const window = 1200
	open := func() *ui.Tester {
		tt := ui.NewTester(shell.New(wb, shell.Options{Only: x.ID}).View, window, 800)
		frame(tt)
		click(t, tt, "会话详情")
		return tt
	}
	const handle = "拖动调整详情面板宽度，双击还原"
	// The rail: from the edge to the window's right.
	rail := func(tt *ui.Tester) float32 {
		t.Helper()
		r, ok := tt.Find(handle)
		if !ok {
			t.Fatalf("no edge: %q", tt.Texts())
		}
		return window - (r.X + r.W/2)
	}
	near := func(what string, got, want float32) {
		t.Helper()
		if got < want-4 || got > want+4 {
			t.Errorf("%s = %v, want about %v", what, got, want)
		}
	}
	drag := func(tt *ui.Tester, by float32) {
		r, _ := tt.Find(handle)
		x, y := r.X+r.W/2, r.Y+r.H/2
		tt.Press(x, y)
		tt.Frame()
		tt.Move(x+by, y)
		tt.Frame()
		tt.Release(x+by, y)
		frame(tt)
	}
	tt := open()
	near("width", rail(tt), 400)
	drag(tt, -150)
	near("dragged", rail(tt), 550)
	drag(tt, -1000)
	near("dragged far", rail(tt), window-360)
	drag(tt, 2000)
	near("dragged close", rail(tt), 300)
	drag(tt, -200)
	near("dragged again", rail(tt), 500)

	tt = open()
	near("next launch", rail(tt), 500)
	r, _ := tt.Find(handle)
	tt.ClickAt(r.X+r.W/2, r.Y+r.H/2)
	tt.ClickAt(r.X+r.W/2, r.Y+r.H/2)
	frame(tt)
	near("reset", rail(tt), 400)
}
