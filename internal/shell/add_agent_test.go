package shell_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

func TestAddAgentFromSettings(t *testing.T) {
	dir := t.TempDir()
	r, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: r.Agents(), Ready: r.Ready})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	ws, err := w.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := shell.New(w, shell.Options{Agents: r})
	tt := ui.NewTester(s.View, 1100, 850)
	frame := func() {
		for range 3 {
			tt.Frame()
		}
	}
	click := func(label string) {
		t.Helper()
		if err := tt.Click(label); err != nil {
			t.Fatalf("%s: %v; %v", label, err, tt.Texts())
		}
		frame()
	}
	fill := func(label, value string) {
		t.Helper()
		click(locales.AgentFieldInput(label))
		tt.Key(ui.Cmd, ui.KeyA)
		tt.Type(value)
		frame()
	}
	waitText := func(label string) {
		t.Helper()
		deadline := time.Now().Add(4 * time.Second)
		for !tt.HasText(label) {
			if time.Now().After(deadline) {
				t.Fatalf("missing %q: %v", label, tt.Texts())
			}
			time.Sleep(5 * time.Millisecond)
			frame()
		}
	}
	frame()
	tt.Key(ui.Super, ui.KeyComma)
	frame()
	click(locales.TabAgents())
	click(locales.AddAgent())
	click(locales.Cancel())
	if _, err := os.Stat(filepath.Join(dir, "agents.json")); !os.IsNotExist(err) {
		t.Fatal("cancel saved configuration")
	}
	click(locales.AddAgent())
	fill(locales.AgentDisplayName(), "Local ACP")
	fill(locales.AgentIdentifier(), "opencode")
	fill(locales.AgentCommand(), exe)
	fill(locales.AgentArguments(), "serve\npath with spaces")
	click(locales.Save())
	waitText(locales.WithDetail(locales.SaveSettingsFailed(), locales.AgentIDInUse()))
	fill(locales.AgentIdentifier(), "local-acp")
	click(locales.Save())
	waitText(locales.AddAgent())
	waitText("Local ACP")
	b, err := os.ReadFile(filepath.Join(dir, "agents.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cfg []agents.ACPConfig
	if err = json.Unmarshal(b, &cfg); err != nil || len(cfg) != 1 || !slices.Equal(cfg[0].Args, []string{"serve", "path with spaces"}) {
		t.Fatalf("configuration %s, %v", b, err)
	}
	click(locales.CloseSettings())
	click(locales.NewSessionIn(filepath.Base(ws.Path)))
	click(locales.NewSessionWith("Local ACP"))
}
