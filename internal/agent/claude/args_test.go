package claude

import (
	"encoding/json"
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
