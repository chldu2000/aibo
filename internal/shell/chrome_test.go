package shell_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

func TestStatusBadgesAndDetails(t *testing.T) {
	release := make(chan struct{})
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "a", Name: "Agent", Input: []byte(`{"description":"查"}`)})
		emit(agent.ToolStarted{ToolID: "c", Parent: "a", Name: "Bash", Input: []byte(`{"command":"sleep 9"}`)})
		emit(agent.ToolStarted{ToolID: "b", Name: "Bash", Input: []byte(`{"command":"make"}`)})
		select {
		case <-release:
		case <-ctx.Done():
			return
		}
		emit(agent.ToolFinished{ToolID: "c", Parent: "a", Output: "ok"})
		emit(agent.ToolFinished{ToolID: "a", Output: "ok"})
		emit(agent.ToolFinished{ToolID: "b", Output: "ok"})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	opened := ""
	tt := ui.NewTester(shell.New(wb, shell.Options{OpenWindow: func(id string) { opened = id }}).View, 1100, 900)
	settle := func() {
		for i := 0; i < 4; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	settle()
	if tt.HasText("个终端进程") || tt.HasText("运行中") {
		t.Errorf("badges show at zero: %q", tt.Texts())
	}
	wb.Send(s.ID, "跑")
	deadline := time.After(5 * time.Second)
	for !tt.HasText("2 个终端进程") {
		select {
		case <-changes:
		case <-deadline:
			t.Fatalf("no terminal badge: %q", tt.Texts())
		case <-time.After(50 * time.Millisecond):
		}
		settle()
	}
	if !tt.HasText("1 个子 Agent 运行中") {
		t.Errorf("no subagent badge: %q", tt.Texts())
	}
	close(release)
	for wb.Status(s.ID).Running {
		<-changes
	}
	settle()
	if tt.HasText("2 个终端进程") || tt.HasText("1 个子 Agent 运行中") {
		t.Errorf("badges stay after the tools ended: %q", tt.Texts())
	}
	for _, w := range []string{"压缩上下文", "引用会话…"} {
		if !tt.HasText(w) {
			t.Errorf("no quick action %q: %q", w, tt.Texts())
		}
	}
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		settle()
	}
	click("引用会话")
	if !tt.HasText("取消") {
		t.Errorf("quoting does not select: %q", tt.Texts())
	}
	click("取消")
	click("在新窗口打开")
	if opened != s.ID {
		t.Errorf("opened %q in a window, want %q", opened, s.ID)
	}
	click("会话详情")
	for _, w := range []string{"权限模式", "原生会话", "工作区", "归档"} {
		if !tt.HasText(w) {
			t.Errorf("details lack %q: %q", w, tt.Texts())
		}
	}
	click("关闭会话详情")
	if tt.HasText("原生会话") {
		t.Error("details do not close")
	}
}

func TestWorkingLineAndRetries(t *testing.T) {
	steps := make(chan agent.Event)
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		for {
			select {
			case e, ok := <-steps:
				if !ok {
					return
				}
				emit(e)
			case <-ctx.Done():
				return
			}
		}
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 900)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(100 * time.Millisecond)
		}
	}
	until := func(what string, cond func() bool) {
		t.Helper()
		deadline := time.After(5 * time.Second)
		for frame(); !cond(); frame() {
			select {
			case <-changes:
			case <-deadline:
				t.Fatalf("no %s: %q", what, tt.Texts())
			case <-time.After(20 * time.Millisecond):
			}
		}
	}
	frame()
	if tt.HasText("正在工作") {
		t.Fatalf("working before any turn: %q", tt.Texts())
	}
	wb.Send(s.ID, "你好")
	until("working line", func() bool { return tt.HasText("假 Agent 正在工作") })
	steps <- agent.Retrying{Message: "Reconnecting... 2/5"}
	until("retry notice", func() bool { return tt.HasText("正在自动重试：Reconnecting... 2/5") })
	steps <- agent.ReplyDelta{ReplyID: "r", Text: "连上了"}
	until("the retry notice gone", func() bool { return !tt.HasText("正在自动重试") })
	if !tt.HasText("正在工作") {
		t.Errorf("the working line went with the retry: %q", tt.Texts())
	}
	close(steps)
	until("the working line gone", func() bool { return !wb.Status(s.ID).Running && !tt.HasText("正在工作") })
}

func TestSessionWindow(t *testing.T) {
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDelta{ReplyID: "r", Text: "先改文件。"})
		emit(agent.ReplyDone{ReplyID: "r"})
		emit(agent.ToolStarted{ToolID: "w", Name: "Write", Input: []byte(`{"file_path":"a.txt"}`)})
		emit(agent.ApprovalRequested{ID: "ap", ToolID: "w", Action: agent.ActionEdit, Paths: []string{"a.txt"},
			Options: []agent.ApprovalOption{{ID: "once", Kind: agent.AllowOnce}, {ID: "no", Kind: agent.Deny}}})
		select {
		case <-f.Decisions():
			emit(agent.ToolFinished{ToolID: "w", Output: "ok"})
		case <-ctx.Done():
		}
	}
	f = fake.New(respond)
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) { changes <- struct{}{} })
	ws, _ := wb.AddWorkspace(t.TempDir())
	src, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(src.ID, "源会话")
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Rename(s.ID, "拆出的会话")

	opened := ""
	mainShell := shell.New(wb, shell.Options{OpenWindow: func(id string) { opened = id }})
	main := ui.NewTester(mainShell.View, 1100, 900)
	var shown []any
	own := shell.New(wb, shell.Options{Only: s.ID, ShowInMain: func(id string, from, to int) { shown = []any{id, from, to} }})
	win := ui.NewTester(own.View, 900, 900)
	frame := func() {
		for _, tt := range []*ui.Tester{main, win} {
			for i := 0; i < 3; i++ {
				tt.Frame()
				tt.Advance(time.Second)
			}
		}
	}
	frame()
	if err := main.Click("拆出的会话"); err != nil {
		t.Fatal(err)
	}
	frame()
	if err := main.Click("在新窗口打开"); err != nil {
		t.Fatal(err)
	}
	if opened != s.ID {
		t.Fatalf("opened %q, want %q", opened, s.ID)
	}
	// The session's own window: its area alone.
	for _, no := range []string{"搜索会话", "源会话", "在新窗口打开"} {
		if win.HasText(no) {
			t.Errorf("the session's window shows %q: %q", no, win.Texts())
		}
	}
	if !win.HasText("拆出的会话") {
		t.Errorf("the session's window lacks its title: %q", win.Texts())
	}
	// Both windows follow the session.
	wb.Send(s.ID, "改文件")
	for wb.Status(s.ID).Approvals == 0 {
		<-changes
	}
	frame()
	for name, tt := range map[string]*ui.Tester{"main": main, "own": win} {
		for _, w := range []string{"先改文件。", "批准本次", "1 个待审批"} {
			if !tt.HasText(w) {
				t.Errorf("the %s window lacks %q: %q", name, w, tt.Texts())
			}
		}
	}
	// Answered in its own window, gone from both.
	if err := win.Click("批准本次"); err != nil {
		t.Fatal(err)
	}
	for wb.Status(s.ID).Running {
		<-changes
	}
	frame()
	for name, tt := range map[string]*ui.Tester{"main": main, "own": win} {
		if _, asks := tt.Find("批准本次"); asks || tt.HasText("正在工作") {
			t.Errorf("the %s window still asks: %q", name, tt.Texts())
		}
	}
	// Another session is the main window's to show.
	own.Open(src.ID)
	if fmt.Sprint(shown) != fmt.Sprint([]any{src.ID, 0, 0}) {
		t.Errorf("shown in the main window: %v", shown)
	}
	frame()
	if !win.HasText("先改文件。") {
		t.Errorf("the session's window left its session: %q", win.Texts())
	}
	// Closing the window leaves the session, which the main window shows.
	own.Close()
	if !main.HasText("拆出的会话") || wb.Status(s.ID).Error != nil {
		t.Errorf("the main window lost the session: %q", main.Texts())
	}
	// Deleted, the session's window says so.
	own2 := shell.New(wb, shell.Options{Only: s.ID})
	win2 := ui.NewTester(own2.View, 900, 900)
	wb.DeleteSession(s.ID)
	win2.Frame()
	if !win2.HasText("这个会话已被删除") {
		t.Errorf("deleted: %q", win2.Texts())
	}
}

// The window moves by its title bar band: the sidebar's header, under the
// traffic lights, and the session area's floating header, right of them
// in a session's own window. What sits there still takes its presses.
// (The Tester does not show the drags themselves: see issue 04.)
func TestTitleBarBand(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	bar := ui.TitleBar{Height: 52, Left: 70, Bottom: 33}
	find := func(tt *ui.Tester, label string) ui.Rect {
		t.Helper()
		r, ok := tt.Find(label)
		if !ok {
			t.Fatalf("no %q in %q", label, tt.Texts())
		}
		return r
	}

	main := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 800)
	main.SetTitleBar(bar)
	if r := find(main, "aibo"); r.Y < bar.Bottom {
		t.Errorf("the sidebar's title at y=%v, under the traffic lights (to %v)", r.Y, bar.Bottom)
	}
	if err := main.Click("会话详情"); err != nil {
		t.Fatal(err)
	}
	main.Frame()
	if !main.HasText("关闭会话详情") {
		t.Errorf("the header's button did nothing: %q", main.Texts())
	}
	if err := main.Click("搜索会话"); err != nil {
		t.Fatal(err)
	}
	main.Type("无此会话")
	main.Frame()
	if !main.HasText("没有找到") {
		t.Errorf("the sidebar's search took no text: %q", main.Texts())
	}

	own := ui.NewTester(shell.New(wb, shell.Options{Only: s.ID}).View, 860, 760)
	own.SetTitleBar(bar)
	if r := find(own, "会话详情"); r.X <= bar.Left {
		t.Errorf("the header's button at x=%v, under the traffic lights (to %v)", r.X, bar.Left)
	}
	if r := find(own, "新会话"); r.X <= bar.Left {
		t.Errorf("the session's title at x=%v, under the traffic lights (to %v)", r.X, bar.Left)
	}
	caption := ui.TitleBar{Height: 32, Right: 138, Bottom: 32}
	for tt, width := range map[*ui.Tester]float32{main: 1100, own: 860} {
		tt.SetTitleBar(caption)
		r := find(tt, "会话详情")
		if r.Y < caption.Bottom && r.X+r.W > width-caption.Right {
			t.Errorf("details button %+v overlaps caption buttons at x=%v", r, width-caption.Right)
		}
	}
}

type testWindow struct {
	minimized, maximized bool
	closed               chan struct{}
}

func (w *testWindow) Minimize()         { w.minimized = true }
func (w *testWindow) IsMaximized() bool { return w.maximized }
func (w *testWindow) ToggleMaximize()   { w.maximized = !w.maximized }
func (w *testWindow) Close()            { close(w.closed) }

func TestWindowCapsule(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(nil)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	for _, name := range []string{"empty", "main", "session"} {
		t.Run(name, func(t *testing.T) {
			opts := shell.Options{}
			if name != "empty" {
				ws, _ := wb.AddWorkspace(t.TempDir())
				session, err := wb.NewSession(ws.ID, fake.Kind, "")
				if err != nil {
					t.Fatal(err)
				}
				if name == "session" {
					opts.Only = session.ID
				}
			}
			sh := shell.New(wb, opts)
			defer sh.Close()
			w := &testWindow{closed: make(chan struct{})}
			sh.SetWindowControls(w)
			tt := ui.NewTester(sh.View, 860, 760)
			find := func(label string) ui.Rect {
				t.Helper()
				r, ok := tt.Find(label)
				if !ok {
					t.Fatalf("missing %s", label)
				}
				return r
			}
			click := func(label string) {
				t.Helper()
				if err := tt.Click(label); err != nil {
					t.Fatal(err)
				}
				tt.Frame()
			}
			minimize := find("最小化窗口")
			maximize := find("最大化窗口")
			shut := find("关闭窗口")
			if minimize.X+minimize.W > maximize.X || maximize.X+maximize.W > shut.X {
				t.Fatal("window buttons overlap")
			}
			if name != "empty" {
				details := find("会话详情")
				if details.X+details.W >= minimize.X || details.Y >= minimize.Y+minimize.H || minimize.Y >= details.Y+details.H {
					t.Fatalf("window buttons %+v not beside session header %+v", minimize, details)
				}
			}
			click("最大化窗口")
			if !w.maximized {
				t.Fatal("maximize did not reach this window")
			}
			click("还原窗口")
			if w.maximized {
				t.Fatal("restore did not reach this window")
			}
			click("最小化窗口")
			if !w.minimized {
				t.Fatal("minimize did not reach this window")
			}
			click("关闭窗口")
			select {
			case <-w.closed:
			case <-time.After(time.Second):
				t.Fatal("close did not reach this window")
			}
		})
	}
}
