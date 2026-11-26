package shell_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/agents/testdata/fakecli"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

type countingModels struct {
	*fake.Agent
	calls atomic.Int32
	reply chan error
}

func (*countingModels) Kind() agent.Kind { return codex.Kind }

func (a *countingModels) Models(ctx context.Context) ([]agent.Model, error) {
	a.calls.Add(1)
	select {
	case err := <-a.reply:
		if err != nil {
			return nil, err
		}
		return []agent.Model{{ID: "big", Name: "Big"}}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func TestModelListDuringDetectionAndAcrossWindows(t *testing.T) {
	a := &countingModels{Agent: fake.New(nil), reply: make(chan error, 1)}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{a}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	reg := agents.New(agents.Options{})
	ws, err := wb.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first, err := wb.NewSession(ws.ID, a.Kind(), "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := wb.NewSession(ws.ID, a.Kind(), "")
	if err != nil {
		t.Fatal(err)
	}
	window := func(id string) (*shell.Shell, *ui.Tester) {
		sh := shell.New(wb, shell.Options{Agents: reg, Only: id})
		t.Cleanup(sh.Close)
		return sh, ui.NewTester(sh.View, 1100, 800)
	}
	mainShell, main := window("")
	mainShell.Open(first.ID)
	_, other := window(first.ID)
	frame := func() {
		for _, tt := range []*ui.Tester{main, other} {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	until := func(what string, ready func() bool) {
		t.Helper()
		for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
			frame()
			if ready() {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatalf("%s: calls=%d main=%q other=%q", what, a.calls.Load(), main.Texts(), other.Texts())
	}
	click := func(tt *ui.Tester) {
		t.Helper()
		if err := tt.Click("模型：默认模型"); err != nil {
			t.Fatal(err)
		}
		frame()
	}
	wantCalls := func(want int32) {
		t.Helper()
		if got := a.calls.Load(); got != want {
			t.Fatalf("model lookups = %d, want %d", got, want)
		}
	}
	// Even with a menu open, discovery must configure the executable first.
	path := fakecli.Install(t, t.TempDir(), "codex", "0.169.0", true)
	frame()
	click(main)
	click(other)
	wantCalls(0)
	reg.SetPath(context.Background(), a.Kind(), path)
	until("one shared lookup", func() bool { return a.calls.Load() == 1 })
	a.reply <- errors.New("temporary failure")
	until("both menus show the failure", func() bool {
		return main.HasText("读不到模型列表：temporary failure") && other.HasText("读不到模型列表：temporary failure")
	})
	for i := 0; i < 5; i++ {
		frame()
	}
	wantCalls(1)
	click(main)
	click(main)
	until("one retry", func() bool { return a.calls.Load() == 2 })
	a.reply <- nil
	until("both windows show the recovered list", func() bool { return main.HasText("Big") && other.HasText("Big") })
	reg.Check(context.Background(), a.Kind())
	click(main)
	mainShell.Open(second.ID)
	frame()
	click(main)
	wantCalls(2)
	click(main)
	click(other)
	reg.SetPath(context.Background(), a.Kind(), fakecli.Install(t, t.TempDir(), "codex", "0.169.0", true))
	frame()
	wantCalls(2) // unnamed defaults need no model details until a menu opens
	click(main)
	click(other)
	until("changed executable read once", func() bool { return a.calls.Load() == 3 })
	a.reply <- nil
	until("both windows show the new list", func() bool { return main.HasText("Big") && other.HasText("Big") })
	wantCalls(3)
}

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

// manyModels is a fake Agent that tells as many models as the Cursor CLI
// does, more than the window has room for: m1 to m50, named Model 1 to
// Model 50.
type manyModels struct{ *fake.Agent }

func (manyModels) Models(context.Context) ([]agent.Model, error) {
	var ms []agent.Model
	for i := 1; i <= 50; i++ {
		ms = append(ms, agent.Model{ID: fmt.Sprintf("m%d", i), Name: fmt.Sprintf("Model %d", i)})
	}
	return ms, nil
}

// A long model list scrolls, opens on the model in use, and can be
// searched, by mouse or keyboard; a short one has no search.
func TestLongModelList(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{manyModels{fake.New(nil)}}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	if err := wb.SetModel(x.ID, "m40", ""); err != nil {
		t.Fatal(err)
	}
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
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}
	model := func() string { got, _ := wb.Session(x.ID); return got.Model }
	open := func() {
		t.Helper()
		if _, shown := tt.Find("搜索模型"); shown { // open still: close it first
			tt.Key(0, ui.KeyEscape)
			frame()
		}
		until("shows the model", func() bool { return tt.HasText("模型：Model ") })
		for _, s := range tt.Texts() {
			if strings.HasPrefix(s, "模型：Model ") {
				click(s)
				break
			}
		}
		until("lists the models", func() bool { return tt.HasText("使用模型 Model 1") })
	}

	// The model in use, far down the list, is in view: it can be chosen.
	open()
	if _, ok := tt.Find("搜索模型"); !ok {
		t.Fatal("no search for 50 models")
	}
	click("使用模型 Model 40")
	if m := model(); m != "m40" {
		t.Errorf("chose %q", m)
	}
	// The rows are taller than the menu has room for (480 at most): the
	// list scrolls, to Model 40 as it opened.
	open()
	first, _ := tt.Find("使用模型 Model 1")
	last, _ := tt.Find("使用模型 Model 50")
	if last.Y-first.Y < 480 {
		t.Fatalf("Model 1 to Model 50 span %v: they fit the menu, the test proves nothing", last.Y-first.Y)
	}

	// Searched: the name or the ID, any case.
	tt.Type("MODEL 5")
	frame()
	if !tt.HasText("使用模型 Model 50") || tt.HasText("使用模型 Model 40") {
		t.Fatalf("searching Model 5 shows %q", tt.Texts())
	}
	click("使用模型 Model 50")
	if m := model(); m != "m50" {
		t.Errorf("chose %q", m)
	}
	open()
	tt.Type("nothing")
	frame()
	if !tt.HasText("没有匹配的模型") {
		t.Errorf("no match shows %q", tt.Texts())
	}

	// By keyboard: the arrows move among the matches, Enter takes one.
	open()
	tt.Type("model 4")
	frame()
	tt.Key(0, ui.KeyDown)
	frame()
	tt.Key(0, ui.KeyDown)
	frame()
	tt.Key(0, ui.KeyEnter)
	frame()
	if m := model(); m != "m40" { // Model 4, then Model 40
		t.Errorf("chose %q by keyboard", m)
	}
	if tt.HasText("使用模型 Model 1") {
		t.Error("the menu stayed open")
	}
}
