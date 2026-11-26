package shell_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// learning tells its models and modes only once it learned them, as an
// ACP Agent that cannot probe for them, and then says they changed.
type learning struct {
	*fake.Agent
	mu      sync.Mutex
	models  []agent.Model
	modes   []agent.PermissionMode
	changed func()
}

func (a *learning) Models(context.Context) ([]agent.Model, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.models == nil {
		return nil, agent.ErrListsUnknown
	}
	return a.models, nil
}

func (a *learning) PermissionModes(context.Context) ([]agent.PermissionMode, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.modes == nil {
		return nil, agent.ErrListsUnknown
	}
	return a.modes, nil
}

func (a *learning) OnListsChanged(f func()) { a.mu.Lock(); a.changed = f; a.mu.Unlock() }

func (a *learning) learn(models []agent.Model, modes []agent.PermissionMode) {
	a.mu.Lock()
	a.models, a.modes = models, modes
	f := a.changed
	a.mu.Unlock()
	f()
}

// The composer's menus follow an Agent that learns its lists: before,
// the model menu says why it is empty; after, both menus offer them.
func TestMenusFollowLearnedLists(t *testing.T) {
	a := &learning{Agent: fake.New(nil)}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{a}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	if _, err := wb.NewSession(ws.ID, fake.Kind, ""); err != nil {
		t.Fatal(err)
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
			time.Sleep(5 * time.Millisecond) // the lists load off the main thread
		}
	}
	shows := func(s string) bool {
		for _, x := range tt.Texts() {
			if strings.Contains(x, s) {
				return true
			}
		}
		return false
	}
	until := func(what string, cond func() bool) {
		t.Helper()
		for i := 0; i < 200 && !cond(); i++ {
			frame()
		}
		if !cond() {
			t.Fatalf("never %s: %q", what, tt.Texts())
		}
	}
	has := func(s string) func() bool { return func() bool { _, ok := tt.Find(s); return ok } }
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}

	until("shows the model", has(locales.ModelLabel(locales.DefaultModel())))
	until("shows the mode", has(locales.ModeLabel(locales.DefaultMode())))
	click(locales.ModelLabel(locales.DefaultModel()))
	until("says why there are no models", func() bool { return shows(locales.ErrListsUnknown()) })
	click(locales.ModelLabel(locales.DefaultModel()))

	a.learn(
		[]agent.Model{{ID: "m0", Name: "M0", Efforts: []string{"low", "default"}, DefaultEffort: "default"}},
		[]agent.PermissionMode{{ID: "build", Name: "build", Risk: agent.Caution, Default: true}, {ID: "plan", Name: "plan", Risk: agent.Caution}},
	)
	until("names the default mode", has(locales.ModeLabel("build")))
	click(locales.ModelLabel(locales.DefaultModel()))
	until("offers the model", has(locales.UseModel("M0")))
}
