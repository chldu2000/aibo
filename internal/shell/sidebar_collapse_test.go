package shell_test

import (
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// The sidebar hides and shows by its button, the header's and ⌘\; the
// choice is kept for the next launch. A narrow window hides it without
// changing that choice.
func TestSidebarCollapse(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	newTester := func(w, h int) *ui.Tester {
		tt := ui.NewTester(shell.New(wb, shell.Options{}).View, w, h)
		frame(tt)
		return tt
	}
	collapsed := func() bool {
		t.Helper()
		var v bool
		if _, err := wb.Pref("sidebarCollapsed", &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	const hide, show = `隐藏侧栏（⌘\）`, `显示侧栏（⌘\）`
	shown := func(tt *ui.Tester, want bool) {
		t.Helper()
		if got := tt.HasText("搜索会话"); got != want {
			t.Fatalf("sidebar shown = %v, want %v: %q", got, want, tt.Texts())
		}
		if tt.HasText(hide) != want || tt.HasText(show) == want {
			t.Fatalf("the button does not say what it does: %q", tt.Texts())
		}
	}

	// Without a session open, the button to show it floats over the header band.
	tt := newTester(1100, 800)
	shown(tt, true)
	click(t, tt, hide)
	shown(tt, false)
	if !collapsed() {
		t.Error("hidden, not kept")
	}
	click(t, tt, show)
	shown(tt, true)

	// With one, the header has it.
	ws, _ := wb.AddWorkspace(t.TempDir())
	wb.NewSession(ws.ID, fake.Kind, "")
	frame(tt)
	click(t, tt, "新会话")
	tt.Key(ui.Cmd, ui.KeyBackslash)
	frame(tt)
	shown(tt, false)
	if !tt.HasText("新会话") {
		t.Fatalf("the session's header went: %q", tt.Texts())
	}

	// The next launch keeps it hidden; ⌘\ shows it again, kept too.
	tt = newTester(1100, 800)
	shown(tt, false)
	tt.Key(ui.Cmd, ui.KeyBackslash)
	frame(tt)
	shown(tt, true)
	if collapsed() {
		t.Error("shown, not kept")
	}

	// Narrow, it hides, and shows for now when asked, the choice kept.
	tt.SetSize(600, 800)
	frame(tt)
	shown(tt, false)
	click(t, tt, show)
	shown(tt, true)
	if collapsed() {
		t.Error("the narrow window changed the choice")
	}
	tt.SetSize(1100, 800)
	frame(tt)
	shown(tt, true)
	tt.SetSize(600, 800)
	frame(tt)
	shown(tt, false) // shown for that time only
}

func frame(tt *ui.Tester) {
	for range 3 {
		tt.Frame()
		tt.Advance(time.Second)
	}
}

func click(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	if err := tt.Click(label); err != nil {
		t.Fatalf("%s: %v; %q", label, err, tt.Texts())
	}
	frame(tt)
}

// The sidebar's divider drags within 200 to 480, the width is kept once
// it rests, and a double click puts it back at 260.
func TestSidebarWidth(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame(tt)
	// The search field spans the sidebar, but for its padding.
	width := func() float32 {
		t.Helper()
		r, ok := tt.Find("搜索会话")
		if !ok {
			t.Fatalf("no search: %q", tt.Texts())
		}
		return r.W + 20
	}
	kept := func() float32 {
		t.Helper()
		var v float32
		if _, err := wb.Pref("sidebarWidth", &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	near := func(what string, got, want float32) {
		t.Helper()
		if got < want-6 || got > want+6 {
			t.Errorf("%s = %v, want about %v", what, got, want)
		}
	}
	drag := func(to float32) {
		divider := width() + 1
		tt.Press(divider, 400)
		tt.Frame()
		tt.Move(to, 400)
		tt.Frame()
		tt.Release(to, 400)
		tt.Frame()
	}
	near("width", width(), 260)

	drag(340)
	if v := kept(); v != 0 {
		t.Errorf("kept %v before resting", v)
	}
	frame(tt)
	near("dragged", width(), 340)
	near("kept", kept(), 340)

	drag(900)
	frame(tt)
	near("dragged far", width(), 480)
	near("kept far", kept(), 480)
	drag(60)
	frame(tt)
	near("dragged close", width(), 200)
	near("kept close", kept(), 200)

	// The next launch takes it back.
	drag(380)
	frame(tt)
	tt = ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame(tt)
	near("next launch", width(), 380)

	divider := width() + 1
	tt.ClickAt(divider, 400)
	tt.ClickAt(divider, 400)
	frame(tt)
	near("reset", width(), 260)
	near("kept reset", kept(), 260)
}
