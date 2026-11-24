package shell_test

import (
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

func TestInspectorBesideConversationAndAboveNarrowDraft(t *testing.T) {
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	ws, _ := w.AddWorkspace(t.TempDir())
	x, _ := w.NewSession(ws.ID, fake.Kind, "")
	main := shell.New(w, shell.Options{})
	defer main.Close()
	detached := shell.New(w, shell.Options{Only: x.ID})
	defer detached.Close()
	wide := ui.NewTester(main.View, 1100, 800)
	narrow := ui.NewTester(detached.View, 440, 520)
	click := func(tt *ui.Tester, name string) {
		t.Helper()
		if err := tt.Click(name); err != nil {
			t.Fatal(err)
		}
		tt.Frame()
		tt.Frame()
	}
	find := func(tt *ui.Tester, name string) ui.Rect {
		t.Helper()
		r, ok := tt.Find(name)
		if !ok {
			t.Fatalf("missing %s", name)
		}
		return r
	}
	prompt := "给 假 Agent 发消息"
	click(wide, "会话详情")
	composer, detail := find(wide, prompt), find(wide, "原生会话")
	if composer.X+composer.W > detail.X {
		t.Fatalf("wide detail overlaps composer: %v %v", composer, detail)
	}
	if narrow.HasText("关闭会话详情") {
		t.Fatal("opening one window's inspector opened another")
	}
	click(narrow, prompt)
	narrow.Type("draft")
	click(narrow, "会话详情")
	composer, detail = find(narrow, prompt), find(narrow, "关闭会话详情")
	if detail.Y+detail.H >= composer.Y {
		t.Fatalf("narrow inspector covers draft: %v %v", composer, detail)
	}
	click(narrow, "关闭会话详情")
	narrow.Type(" restored")
	narrow.Frame()
	field, ok := narrow.Access(prompt)
	if !ok || field.Value != "draft restored" || !wide.HasText("关闭会话详情") {
		t.Fatalf("focus, draft or other inspector lost: %q", field.Value)
	}
}
