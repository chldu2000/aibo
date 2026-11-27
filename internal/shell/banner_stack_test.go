package shell_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// Four notices above the composer: the one asking most shows, the others
// fold into a line that opens them. An archived session says so by its
// title, not above the composer.
func TestBannerStack(t *testing.T) {
	respond := func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "the reply"})
		emit(agent.NotLoggedIn{})
		emit(agent.Failed{Message: "boom"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}, IdleCheck: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	dir := filepath.Join(t.TempDir(), "gone")
	os.Mkdir(dir, 0o755)
	ws, _ := wb.AddWorkspace(dir)
	x, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(x.ID, "go")
	for wb.Status(x.ID).Running {
		<-changes
	}
	os.RemoveAll(dir)
	for w, _ := wb.Workspace(ws.ID); !w.Missing; w, _ = wb.Workspace(ws.ID) {
		<-changes
	}
	sh := shell.New(wb, shell.Options{Only: x.ID})
	tt := ui.NewTester(sh.View, 1100, 800)
	sh.Reveal(x.ID, 1, 1)
	frame(tt)

	const login, missing, failure, highlight = "未登录", "工作区目录不存在", "boom", "已高亮被引用的范围"
	shows := func(want map[string]bool) {
		t.Helper()
		for text, w := range want {
			if tt.HasText(text) != w {
				t.Errorf("%q shown = %v, want %v: %q", text, !w, w, tt.Texts())
			}
		}
	}
	shows(map[string]bool{login: true, missing: false, failure: false, highlight: false, "还有 3 条提示": true})

	click(t, tt, "还有 3 条提示")
	shows(map[string]bool{login: true, missing: true, failure: true, highlight: true, "收起提示": true})
	// Those that ask come first.
	l, m, f := findPart(t, tt, login), findPart(t, tt, missing), findPart(t, tt, failure)
	if !(l.Y < m.Y && m.Y < f.Y) {
		t.Errorf("not in order: signed out at %v, folder at %v, failure at %v", l.Y, m.Y, f.Y)
	}
	click(t, tt, "收起提示")
	shows(map[string]bool{missing: false, "还有 3 条提示": true})

	// A notice closed from the opened list, one fewer folds.
	click(t, tt, "还有 3 条提示")
	click(t, tt, "取消高亮")
	click(t, tt, "收起提示")
	shows(map[string]bool{highlight: false, "还有 2 条提示": true})

	wb.SetArchived(x.ID, true)
	frame(tt)
	if !tt.HasText("已归档") || tt.HasText("这个会话已归档") {
		t.Errorf("the archived session does not say so by its title: %q", tt.Texts())
	}
}

// findPart is where the first text holding part shows.
func findPart(t *testing.T, tt *ui.Tester, part string) ui.Rect {
	t.Helper()
	for _, s := range tt.Texts() {
		if strings.Contains(s, part) {
			if r, ok := tt.Find(s); ok {
				return r
			}
		}
	}
	t.Fatalf("no %q: %q", part, tt.Texts())
	return ui.Rect{}
}
