package shell_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// Managing workspaces and sessions from the sidebar.
func TestSidebarManagement(t *testing.T) {
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "回复：" + turn.Text})
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{withModels{fake.New(respond)}}})
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
	root := t.TempDir()
	proj := filepath.Join(root, "shop-api")
	os.Mkdir(proj, 0o755)
	ws, _ := wb.AddWorkspace(proj)
	a, _ := wb.NewSession(ws.ID, fake.Kind, "")
	b, _ := wb.NewSession(ws.ID, fake.Kind, "")
	for id, text := range map[string]string{a.ID: "迁移方案 timestamptz", b.ID: "白屏排查"} {
		wb.Send(id, text)
		for wb.Status(id).Running {
			<-changes
		}
	}
	wb.ReferenceSession(a.ID, b.ID)
	wb.Send(b.ID, "看引用")
	for wb.Status(b.ID).Running {
		<-changes
	}
	var chosen string
	sh := shell.New(wb, shell.Options{ChooseFolder: func() (string, bool) { return chosen, true }})
	tt := ui.NewTester(sh.View, 1100, 900)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	frame()
	click := func(s string) {
		t.Helper()
		if err := tt.Click(s); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}
	menu := func(row, item string) {
		t.Helper()
		if err := tt.RightClick(row); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		if err := tt.ChooseMenuItem(item); err != nil {
			t.Fatalf("%v; the menu is %q", err, tt.Menu())
		}
		frame()
	}
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}
	shows("引用 1") // b received one

	menu("迁移方案 timestamptz", "重命名…")
	tt.Key(ui.Super, ui.KeyA)
	tt.Type("迁移方案（定稿）")
	click("确定")
	if x, _ := wb.Session(a.ID); x.Title != "迁移方案（定稿）" {
		t.Errorf("title = %q", x.Title)
	}

	menu("迁移方案（定稿）", "归档")
	if x, _ := wb.Session(a.ID); !x.Archived {
		t.Error("not archived")
	}
	shows("已归档 · 1")
	click("已归档 · 1")
	shows("迁移方案（定稿）")

	// Search finds it, archived, by its words.
	click("搜索会话")
	tt.Type("timestamptz")
	frame()
	shows("迁移方案 timestamptz") // the snippet
	tt.Key(ui.Super, ui.KeyA)
	tt.Key(0, ui.KeyBackspace)
	frame()

	// Deleting a session referenced says what it breaks.
	menu("迁移方案（定稿）", "删除…")
	shows("删除「迁移方案（定稿）」？", "该会话被 1 个引用使用，删除后这些引用将失效。")
	click("确定删除")
	if _, ok := wb.Session(a.ID); ok {
		t.Error("not deleted")
	}

	// A folder dropped on the window is a workspace.
	dropped := t.TempDir()
	tt.DropFiles(600, 400, dropped)
	frame()
	if got := wb.Workspaces(); len(got) != 2 {
		t.Errorf("workspaces after dropping = %+v", got)
	}

	// A lone Agent: "+" starts a session at once, on the Agent's own
	// default model.
	click("在 " + filepath.Base(dropped) + " 新建会话")
	var made model.Session
	for _, x := range wb.Sessions() {
		if x.WorkspaceID != ws.ID {
			made = x
		}
	}
	if made.ID == "" || made.Model != "" {
		t.Errorf("new session = %+v", made)
	}
	shows("默认模型")

	// The folder moved away: the session says so, and can be pointed at
	// where it went.
	os.Rename(proj, filepath.Join(root, "moved"))
	wb.CheckWorkspaces()
	click("白屏排查")
	shows("目录不存在", "工作区目录不存在："+proj)
	chosen = filepath.Join(root, "moved")
	click("重新定位…")
	for i := 0; i < 50; i++ {
		if w, _ := wb.Workspace(ws.ID); !w.Missing {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	frame()
	if tt.HasText("工作区目录不存在") {
		t.Error("the banner stayed after relocating")
	}

	// Removing the workspace archives its sessions.
	menu("moved", "移除工作区（会话转为归档）")
	if x, _ := wb.Session(b.ID); !x.Archived {
		t.Error("its session was not archived")
	}
}
