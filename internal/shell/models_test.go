package shell_test

import (
	"context"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// withEfforts is a fake Agent that tells models taking reasoning
// efforts: its default, which runs as fake.DefaultModel, and two more.
type withEfforts struct{ *fake.Agent }

func (withEfforts) Models(context.Context) ([]agent.Model, error) {
	return []agent.Model{
		{Name: "默认", Resolved: fake.DefaultModel, Efforts: []string{"low", "high"}, DefaultEffort: "low"},
		{ID: "big", Name: "Big", Efforts: []string{"low", "high", "max"}, DefaultEffort: "high"},
		{ID: "tiny", Name: "Tiny"},
	}, nil
}

// The composer changes the model and the effort between turns, not
// during one; an effort the new model does not take becomes its default.
func TestChangeModelAndEffort(t *testing.T) {
	release := make(chan struct{})
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Text == "wait" {
			select {
			case <-release:
			case <-ctx.Done():
			}
		}
	}
	f := fake.New(respond)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{withEfforts{f}}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
			time.Sleep(5 * time.Millisecond) // the models load off the main thread
		}
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
	session := func() (string, string) {
		got, _ := wb.Session(x.ID)
		return got.Model, got.Effort
	}

	// Not started: the Agent's own, as yet unnamed.
	until("shows the model", has("模型：默认模型"))
	// Started, the Agent says what it runs: the default's name, and the
	// default's efforts.
	wb.Send(x.ID, "hi")
	until("the Agent reports", has("模型：默认"))
	until("shows the effort", has("推理强度：默认"))

	// Running: the menus do not open.
	wb.Send(x.ID, "wait")
	until("the turn runs", func() bool { return wb.Status(x.ID).Running })
	frame()
	click("模型：默认")
	if tt.HasText("使用模型 Big") {
		t.Error("the model menu opened during a turn")
	}
	close(release)
	until("the turn ends", func() bool { return !wb.Status(x.ID).Running })

	click("模型：默认")
	click("使用模型 Big")
	if m, e := session(); m != "big" || e != "" {
		t.Errorf("after Big: %q %q", m, e)
	}
	click("推理强度：默认")
	click("推理强度 max")
	if m, e := session(); m != "big" || e != "max" {
		t.Errorf("after max: %q %q", m, e)
	}
	until("shows max", has("推理强度：max"))
	// The default does not take max: its default effort instead.
	click("模型：Big")
	click("使用模型 默认")
	if m, e := session(); m != "" || e != "low" {
		t.Errorf("back to the default: %q %q", m, e)
	}
	// A model that takes no effort: none, and no effort menu.
	click("模型：默认")
	click("使用模型 Tiny")
	if m, e := session(); m != "tiny" || e != "" {
		t.Errorf("after Tiny: %q %q", m, e)
	}
	if _, ok := tt.Find("推理强度：low"); ok {
		t.Error("an effort menu for a model that takes none")
	}
	want := []fake.ModelSet{{Model: "big"}, {Model: "big", Effort: "max"}, {Effort: "low"}, {Model: "tiny"}}
	if got := f.ModelSets(); len(got) != len(want) {
		t.Errorf("the native session got %+v", got)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Errorf("change %d = %+v, want %+v", i, got[i], want[i])
			}
		}
	}

	// The details say it too.
	click("会话详情")
	if !tt.HasText("Tiny") {
		t.Errorf("details: %q", tt.Texts())
	}
}
