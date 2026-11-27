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
	tt.Key(ui.Cmd, ui.KeyComma)
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
	click(locales.EditACPLabel("Local ACP"))
	fill(locales.AgentDisplayName(), "Local edited")
	fill(locales.AgentArguments(), "serve\n--config\npath with spaces")
	click(locales.Save())
	waitText("Local edited")
	if got, _ := r.ACPConfig("local-acp"); !slices.Equal(got.Args, []string{"serve", "--config", "path with spaces"}) {
		t.Fatalf("edited arguments = %q", got.Args)
	}
	click(locales.RemoveACPLabel("Local edited"))
	click(locales.Cancel())
	click(locales.CloseSettings())
	click(locales.NewSessionIn(filepath.Base(ws.Path)))
	click(locales.NewSessionWith("Local edited"))
	tt.Key(ui.Cmd, ui.KeyComma)
	frame()
	click(locales.TabAgents())
	click(locales.RemoveACPLabel("Local edited"))
	click(locales.ConfirmRemoveLabel())
	waitText(locales.AddAgent())
	if _, exists := r.ACPConfig("local-acp"); exists || len(w.Sessions()) != 1 {
		t.Fatal("deletion did not preserve exactly the existing conversation")
	}
	click(locales.EditACPLabel("OpenCode"))
	fill(locales.AgentCommand(), exe)
	fill(locales.AgentArguments(), "--stdio")
	click(locales.Save())
	waitText(locales.AddAgent())
	if got, _ := r.ACPConfig(agents.OpenCode); !slices.Equal(got.Args, []string{"--stdio"}) || got.ToolPrefix != nil {
		t.Fatalf("edited OpenCode configuration = %+v", got)
	}
	click(locales.RemoveACPLabel("OpenCode"))
	click(locales.ConfirmRemoveLabel())
	waitText(locales.RestoreACP("OpenCode"))
	click(locales.RestoreACP("OpenCode"))
	waitText("OpenCode")
	if got, ok := r.ACPConfig(agents.OpenCode); !ok || got.Command != "opencode" || !slices.Equal(got.Args, []string{"acp"}) {
		t.Fatalf("restored OpenCode configuration = %+v", got)
	}
}

// Editing an Agent in the settings keeps the mode labels that only
// agents.json holds.
func TestEditKeepsModeLabels(t *testing.T) {
	dir := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command, _ := json.Marshal(exe)
	seed := `[{"id":"labelled","name":"Labelled","command":` + string(command) + `,"modes":{"bypassPermissions":{"risk":"danger"}}}]`
	if err := os.WriteFile(filepath.Join(dir, "agents.json"), []byte(seed), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: r.Agents(), Ready: r.Ready})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	tt := ui.NewTester(shell.New(w, shell.Options{Agents: r}).View, 1100, 850)
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
	frame()
	tt.Key(ui.Cmd, ui.KeyComma)
	frame()
	click(locales.TabAgents())
	click(locales.EditACPLabel("Labelled"))
	click(locales.AgentFieldInput(locales.AgentDisplayName()))
	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("Renamed")
	frame()
	click(locales.Save())
	deadline := time.Now().Add(4 * time.Second)
	for {
		got, _ := r.ACPConfig("labelled")
		if got.Name == "Renamed" {
			if got.Modes["bypassPermissions"].Risk != "danger" {
				t.Fatalf("modes after editing = %+v", got.Modes)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("never saved: %+v", got)
		}
		time.Sleep(5 * time.Millisecond)
		frame()
	}
	b, _ := os.ReadFile(filepath.Join(dir, "agents.json"))
	var saved []agents.ACPConfig
	if err := json.Unmarshal(b, &saved); err != nil || len(saved) != 1 || saved[0].Modes["bypassPermissions"].Risk != "danger" {
		t.Fatalf("agents.json = %s, %v", b, err)
	}
}
