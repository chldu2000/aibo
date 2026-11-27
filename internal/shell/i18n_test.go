package shell_test

import (
	"context"
	"encoding/json"
	"go/scanner"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// smoke drives the main screens in the language of the moment: a session
// waiting on an approval, answered, and the settings. want are the texts
// each step shows, in that language; every control's label is unique on
// its screen, as the Tester finds controls by them.
func smoke(t *testing.T, want map[string][]string) {
	t.Helper()
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{ToolID: "t", Name: "Bash", Input: []byte(`{"command":"go test ./..."}`)})
		emit(agent.ApprovalRequested{ID: "a", ToolID: "t", Action: agent.ActionCommand, Command: "go test ./...", Options: []agent.ApprovalOption{
			{ID: "once", Kind: agent.AllowOnce},
			{ID: "session", Kind: agent.AllowSession, Grants: []agent.Grant{{Kind: agent.GrantCommand, Items: []string{"go test ./..."}}}},
			{ID: "no", Kind: agent.Deny},
		}})
		select {
		case <-f.Decisions():
			emit(agent.ToolFinished{ToolID: "t", Output: "ok"})
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
	s, _ := wb.NewSession(ws.ID, fake.Kind, "")
	wb.Send(s.ID, "go")
	for wb.Status(s.ID).Approvals == 0 {
		<-changes
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 900)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
		}
	}
	shows := func(step string) {
		t.Helper()
		for _, w := range want[step] {
			if !tt.HasText(w) {
				t.Errorf("%s: the window lacks %q: %q", step, w, tt.Texts())
			}
		}
		seen := map[string]bool{}
		for _, a := range tt.AccessAll() {
			switch a.Role {
			// Labelled boxes, as the icon buttons, are groups.
			case ui.RoleGroup, ui.RoleButton, ui.RoleTextField, ui.RoleSwitch, ui.RoleTab, ui.RolePopUpButton:
				if a.Name != "" && seen[a.Name] {
					t.Errorf("%s: two controls are labelled %q", step, a.Name)
				}
				seen[a.Name] = true
			}
		}
	}
	click := func(label string) {
		t.Helper()
		if err := tt.Click(label); err != nil {
			t.Fatalf("%v; the window shows %q", err, tt.Texts())
		}
		frame()
	}
	frame()
	shows("asked")
	click(want["answer"][0])
	for wb.Status(s.ID).Running {
		<-changes
	}
	frame()
	shows("answered")
	click(want["settings"][0])
	shows("settings")
}

func TestEnglish(t *testing.T) {
	inLocale(t, "en")
	smoke(t, map[string][]string{
		"asked":    {"Needs approval · Run a command", "Allow once", "Always allow in this session", "Deny…", "Show the rules it will allow", "1 approval pending", "Message 假 Agent"},
		"answer":   {"Allow once"},
		"answered": {"Approval: Allow once", "More for this session"},
		"settings": {"Settings (⌘,)", "Data directory", "Default permission mode for new sessions", "Notify when an approval is waiting", "General", "Advanced"},
	})
}

func TestChinese(t *testing.T) {
	smoke(t, map[string][]string{
		"asked":    {"需要审批 · 执行命令", "批准本次", "本会话内始终允许", "拒绝…", "查看将允许的规则", "1 个待审批", "给 假 Agent 发消息"},
		"answer":   {"批准本次"},
		"answered": {"审批：批准本次", "会话的更多操作"},
		"settings": {"设置（⌘,）", "数据目录", "新会话的默认权限模式", "有待审批时发系统通知", "通用", "高级"},
	})
}

// The shell says nothing in Go code: what the user reads is in locales/.
// Its non-test files, and the app's, hold no string with Chinese in it.
func TestNoTextInCode(t *testing.T) {
	var files []string
	for _, pattern := range []string{"*.go", "../../cmd/aibo/*.go"} {
		m, _ := filepath.Glob(pattern)
		files = append(files, m...)
	}
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		fset := token.NewFileSet()
		var s scanner.Scanner
		s.Init(fset.AddFile(name, -1, len(src)), src, nil, 0) // comments skipped
		for {
			pos, tok, lit := s.Scan()
			if tok == token.EOF {
				break
			}
			if tok == token.STRING && strings.IndexFunc(lit, func(r rune) bool { return unicode.Is(unicode.Han, r) }) >= 0 {
				t.Errorf("%s: %s: text in code, not in locales/", fset.Position(pos), lit)
			}
		}
	}
}

// Both catalogs say every message.
func TestCatalogsComplete(t *testing.T) {
	keys := func(name string) map[string]bool {
		b, err := os.ReadFile(filepath.Join("../../locales", name))
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for k := range m {
			if !strings.HasPrefix(k, "@") {
				out[k] = true
			}
		}
		return out
	}
	en, zh := keys("en.json"), keys("zh-Hans.json")
	for k := range en {
		if !zh[k] {
			t.Errorf("zh-Hans lacks %s", k)
		}
	}
	for k := range zh {
		if !en[k] {
			t.Errorf("en lacks %s", k)
		}
	}
}
