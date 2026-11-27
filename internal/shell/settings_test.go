package shell_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/agents/testdata/fakecli"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

type settingsAgent struct {
	*fake.Agent
	name string
}

func (a settingsAgent) Name() string     { return a.name }
func (a settingsAgent) Kind() agent.Kind { return agent.Kind(a.name) }

func TestGeneralSettingsWithTwoAgents(t *testing.T) {
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{
		settingsAgent{fake.New(nil), "Claude Code"}, settingsAgent{fake.New(nil), "Codex"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 900, 780)
	if err := tt.Click(keyed("设置", ",")); err != nil {
		t.Fatal(err)
	}
	find := func(label string) ui.Rect {
		t.Helper()
		for range 100 {
			tt.Frame()
			if r, ok := tt.Find(label); ok {
				return r
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatalf("missing %s", label)
		return ui.Rect{}
	}
	first := find("新会话的默认权限模式：Claude Code")
	second := find("新会话的默认权限模式：Codex")
	title := find("新会话的默认权限模式")
	if title.H > 30 || first.Y == second.Y {
		t.Errorf("default modes title height %.0f, selector rows at %.0f and %.0f", title.H, first.Y, second.Y)
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "general-two-agents.png"))
	}
}

// The settings: the default approval level, notifications, the advanced
// budgets, and moving the data directory.
func TestSettingsModal(t *testing.T) {
	block := make(chan struct{})
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Text == "busy" {
			select {
			case <-block:
			case <-ctx.Done():
			}
		}
	}
	dataDir := t.TempDir()
	wb, err := workbench.Open(workbench.Options{DataDir: dataDir, Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	chosen := ""
	var moved []string
	logsOpened := 0
	sh := shell.New(wb, shell.Options{
		DataDir:      dataDir,
		ChooseFolder: func() (string, bool) { return chosen, true },
		MoveDataDir:  func(to string) error { moved = append(moved, to); return nil },
		OpenLogs:     func() { logsOpened++ },
	})
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
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}

	click(keyed("设置", ","))
	shows("数据目录", dataDir, "新会话的默认权限模式", "有待审批时发系统通知")
	click("打开日志目录")
	if logsOpened != 1 {
		t.Errorf("the logs opened %d times", logsOpened)
	}
	for i := 0; i < 50 && !tt.HasText("新会话的默认权限模式：假 Agent"); i++ {
		time.Sleep(5 * time.Millisecond) // the modes load off the main thread
		frame()
	}
	click("新会话的默认权限模式：假 Agent")
	click("Edits")
	if got := wb.Settings().DefaultModes[fake.Kind]; got != fake.ModeEdits {
		t.Errorf("default mode = %q", got)
	}
	click("有待审批时发系统通知（开关）")
	if wb.Settings().Notify {
		t.Error("notifications still on")
	}

	// A folder in a sync service warns; one with aibo's data is used as is.
	syncDir := filepath.Join(t.TempDir(), "Library", "Mobile Documents", "aibo")
	os.MkdirAll(syncDir, 0o755)
	chosen = syncDir
	click("更改…")
	for i := 0; i < 50 && !tt.HasText("改到："+syncDir); i++ {
		time.Sleep(10 * time.Millisecond) // the folder is chosen off the main thread
		frame()
	}
	shows("改到："+syncDir, "这个文件夹在 iCloud Drive 里", "aibo 会把数据复制过去")
	click("取消")
	withData := t.TempDir()
	os.WriteFile(filepath.Join(withData, "aibo.db"), nil, 0o644)
	chosen = withData
	click("更改…")
	for i := 0; i < 50 && !tt.HasText("改到："+withData); i++ {
		time.Sleep(10 * time.Millisecond)
		frame()
	}
	shows("这个文件夹里已经有 aibo 的数据")
	click("确定更改")
	for i := 0; i < 50 && len(moved) == 0; i++ {
		time.Sleep(10 * time.Millisecond)
		frame()
	}
	if len(moved) != 1 || moved[0] != withData {
		t.Errorf("moved = %v", moved)
	}

	click("高级")
	set := func(field, value string) {
		t.Helper()
		if err := tt.Click(field + "（数值）"); err != nil {
			t.Fatal(err)
		}
		tt.Key(ui.Cmd, ui.KeyA)
		tt.Type(value)
	}
	set("read_reference 每页", "10") // too small
	click("保存")
	shows("设置的值不在允许的范围内")
	set("read_reference 每页", "12000")
	set("闲置自动断开", "45")
	click("保存")
	if st := wb.Settings(); st.Budgets.Page != 12000 || st.IdleTimeout != 45*time.Minute {
		t.Errorf("settings = %+v", st)
	}
	if tt.HasText("设置的值不在允许的范围内") {
		t.Error("the error stayed")
	}

	// While a session runs, the data stays where it is.
	click("关闭设置")
	ws, _ := wb.AddWorkspace(t.TempDir())
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "busy")
	tt.Key(ui.Cmd, ui.KeyComma)
	frame()
	click("通用")
	click("更改…")
	shows("有会话正在运行。请先等它完成或停止，再更改数据目录。")
	close(block)
}

// The Agents as found: the settings' Agent page, unavailable ones grayed
// in the new-session picker, and a session's Agent signed out.
func TestAgentsFoundAndSignedOut(t *testing.T) {
	bin := t.TempDir()
	t.Setenv("PATH", bin)
	claudePath := fakecli.Install(t, bin, "claude", "2.1.318", false)
	fakecli.Install(t, bin, "codex", "0.168.0", false)
	reg := agents.New(agents.Options{Shell: filepath.Join(bin, "unused"), Dirs: []string{bin}})
	reg.Detect(context.Background())

	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: reg.Agents(), Ready: reg.Ready})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	ws, _ := wb.AddWorkspace(t.TempDir())
	var opened []string
	s := shell.New(wb, shell.Options{Agents: reg, OpenTerminal: func(p string) { opened = append(opened, p) }})
	tt := ui.NewTester(s.View, 1100, 900)
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
	shows := func(want ...string) {
		t.Helper()
		for _, w := range want {
			if !tt.HasText(w) {
				t.Errorf("the window lacks %q: %q", w, tt.Texts())
			}
		}
	}

	// Codex is too old: grayed in the picker, with why.
	click("在 " + filepath.Base(ws.Path) + " 新建会话")
	shows("版本 0.168.0 过低，请升级到 0.169.0 或更高版本。")
	if err := tt.Click("用 Codex 新建会话"); err == nil {
		t.Error("an unavailable Agent can start a session")
	}
	click("用 Claude Code 新建会话")

	// Claude Code is signed out: the session says so, and how to sign in.
	shows("Claude Code 未登录。")
	click("在终端中打开 claude")
	if real, _ := filepath.EvalSymlinks(claudePath); len(opened) != 1 || opened[0] != real {
		t.Errorf("opened %v", opened)
	}
	click("去登录")
	shows("Agent", "未登录", "版本过低", "请在终端里运行 claude 完成登录", "版本 2.1.318")
	click("复制命令")
	if real, _ := filepath.EvalSymlinks(claudePath); tt.Clipboard() != real {
		t.Errorf("clipboard = %q", tt.Clipboard())
	}
}

// withModels is a fake Agent that tells its models.
type withModels struct{ *fake.Agent }

func (withModels) Models(context.Context) ([]agent.Model, error) {
	return []agent.Model{{Name: "默认（Sonnet）"}, {ID: "opus", Name: "Opus", Description: "最强"}}, nil
}
