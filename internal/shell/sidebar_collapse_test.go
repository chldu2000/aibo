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
	tt.Key(ui.Super, ui.KeyBackslash)
	frame(tt)
	shown(tt, false)
	if !tt.HasText("新会话") {
		t.Fatalf("the session's header went: %q", tt.Texts())
	}

	// The next launch keeps it hidden; ⌘\ shows it again, kept too.
	tt = newTester(1100, 800)
	shown(tt, false)
	tt.Key(ui.Super, ui.KeyBackslash)
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
