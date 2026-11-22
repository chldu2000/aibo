package claude

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// The workbench's MCP server is the only one, its tools need no approval,
// and its token is never on the command line.
func TestArgsInjectTheWorkbenchServer(t *testing.T) {
	a := New("claude")
	args := a.args(agent.StartOptions{Workspace: "/w", Model: "haiku", ResumeID: "s1", MCP: &agent.MCPServer{URL: "http://127.0.0.1:5/mcp", Token: "secret-token"}})
	line := strings.Join(args, " ")
	if strings.Contains(line, "secret-token") {
		t.Fatalf("the token is on the command line: %s", line)
	}
	for _, want := range []string{"--strict-mcp-config", "--resume s1", "--model haiku", "--allowedTools mcp__aibo__*"} {
		if !strings.Contains(line, want) {
			t.Errorf("args lack %q: %s", want, line)
		}
	}
	i := slices.Index(args, "--mcp-config")
	var cfg struct {
		McpServers map[string]struct {
			Type    string            `json:"type"`
			URL     string            `json:"url"`
			Headers map[string]string `json:"headers"`
		} `json:"mcpServers"`
	}
	if i < 0 || json.Unmarshal([]byte(args[i+1]), &cfg) != nil {
		t.Fatalf("no --mcp-config: %s", line)
	}
	s := cfg.McpServers["aibo"]
	if len(cfg.McpServers) != 1 || s.Type != "http" || s.URL != "http://127.0.0.1:5/mcp" || s.Headers["Authorization"] != "Bearer ${"+tokenVar+"}" {
		t.Errorf("mcp config = %s", args[i+1])
	}
	if got := a.args(agent.StartOptions{}); slices.Contains(got, "--mcp-config") {
		t.Errorf("a session without the server: %v", got)
	}
}

// A session's level and rules are on its command line.
func TestArgsApplyModeAndRules(t *testing.T) {
	a := New("claude")
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	rules := []agent.Rule{
		{Label: "Bash(go test ./...)", Data: raw(`{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"go test ./..."}],"behavior":"allow","destination":"localSettings"}`)},
		{Label: "访问 /src", Data: raw(`{"type":"addDirectories","directories":["/src"],"destination":"session"}`)},
		{Label: "自动接受修改", Data: raw(`{"type":"setMode","mode":"acceptEdits","destination":"session"}`)},
	}
	line := strings.Join(a.args(agent.StartOptions{Mode: "default", Rules: rules, MCP: &agent.MCPServer{URL: "u", Token: "t"}}), " ")
	for _, want := range []string{"--permission-mode acceptEdits", "--add-dir /src", "--allowedTools mcp__aibo__* Bash(go test ./...)"} {
		if !strings.Contains(line, want) {
			t.Errorf("args lack %q: %s", want, line)
		}
	}
	// A rule never lowers the mode.
	if line := strings.Join(a.args(agent.StartOptions{Mode: "bypassPermissions", Rules: rules}), " "); !strings.Contains(line, "--permission-mode bypassPermissions") {
		t.Errorf("bypassPermissions: %s", line)
	}
	// No mode, no rule: Claude Code's own default; the option to go to
	// bypassPermissions later is always there.
	if line := strings.Join(a.args(agent.StartOptions{}), " "); strings.Contains(line, "--permission-mode") || !strings.Contains(line, "--allow-dangerously-skip-permissions") {
		t.Errorf("no mode: %s", line)
	}
}

// Other workspaces it may read: added, and their changes denied, also
// where a link leads (/tmp is /private/tmp).
func TestArgsReadDirs(t *testing.T) {
	dir := t.TempDir() // under /var/folders, a link to /private/var/folders
	line := strings.Join(New("claude").args(agent.StartOptions{ReadDirs: []string{dir}}), " ")
	real, _ := filepath.EvalSymlinks(dir)
	for _, want := range []string{"--add-dir " + dir, "Edit(/" + dir + "/**)", "Write(/" + dir + "/**)", "Edit(/" + real + "/**)"} {
		if !strings.Contains(line, want) {
			t.Errorf("args lack %q: %s", want, line)
		}
	}
	if real == dir {
		t.Log("the temp dir is no link here")
	}
}
