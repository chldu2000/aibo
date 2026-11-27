package claude

import (
	"context"
	"encoding/json"

	"github.com/chldu2000/aibo/internal/agent"
)

// Claude Code's Agent commands: it tells them as a session starts
// (initialize's answer) and whenever they change (system/commands_changed),
// each time all of them. It runs most of them itself, given "/name args"
// as the user's message (.scratch/agent-commands/research/01).

// builtins rules on each of Claude Code's own commands (builtin: true),
// as .scratch/agent-commands/issues/03 does: how each is carried out.
// One not here is not offered: a command added by an upgrade waits for a
// ruling, which the contract test asks for.
var builtins = map[string]agent.Handling{
	// Prompts: a turn of the model's, asking as any does.
	"init": agent.ByAgent, "code-review": agent.ByAgent, "security-review": agent.ByAgent,
	"simplify": agent.ByAgent, "debug": agent.ByAgent, "verify": agent.ByAgent,
	"batch": agent.ByAgent, "run": agent.ByAgent, "run-skill-generator": agent.ByAgent,
	"dataviz": agent.ByAgent, "claude-api": agent.ByAgent, "plugin-authoring": agent.ByAgent,
	"update-config": agent.ByAgent, "fewer-permission-prompts": agent.ByAgent,
	"auto-mode-setup": agent.ByAgent, "schedule": agent.ByAgent, "insights": agent.ByAgent,
	"team-onboarding": agent.ByAgent,
	// Local, telling what aibo does not show, or changing what it does
	// not show: their output is marked so.
	"context": agent.ByAgent, "usage": agent.ByAgent, "reload-skills": agent.ByAgent,
	"output-style": agent.ByAgent,
	// They change what the workbench's controls show, and Claude Code
	// would not report it.
	"model": agent.ByModel, "effort": agent.ByEffort, "compact": agent.ByCompact,
	"rename": agent.ByRename,
	// A new native session, which system/init then names.
	"clear": agent.ByReset,
}

// ruledOut are the built-ins ruled out, for the contract test to tell
// them from those not ruled on: terminal-only, removed, server-side,
// disconnecting aibo's MCP server, writing the user's global config,
// starting turns of their own, or not tested.
var ruledOut = map[string]bool{
	"doctor": true, "color": true, "focus": true, "reload-plugins": true,
	"agents": true, "extra-usage": true, "__remote-workflow": true, "workflow-launch-exec": true,
	"mcp": true, "config": true, "loop": true, "goal": true,
	"autocompact": true, "fast": true, "heapdump": true, "usage-credits": true, "recap": true, "list-agents": true,
	// New in 2.1.332, not tested yet.
	"design": true, "design-sync": true, "design-consent": true, "design-revoke": true,
	"claude-approvals": true, "advisor": true, "import": true, "ultrareview": true, "skill-doctor": true,
}

// command is one as Claude Code tells it.
type command struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	ArgumentHint string   `json:"argumentHint"`
	Aliases      []string `json:"aliases"`
	Builtin      bool     `json:"builtin"`
}

// offered are the commands aibo offers of those Claude Code told: its
// own ruled on, and all the others (the user's, the project's, plugins',
// skills). Claude Code tells no source, but in its descriptions.
func offered(told []command) []agent.Command {
	out := []agent.Command{}
	for _, c := range told {
		h := agent.ByAgent
		if c.Builtin {
			var ok bool
			if h, ok = builtins[c.Name]; !ok {
				continue
			}
		}
		out = append(out, agent.Command{Name: c.Name, Aliases: c.Aliases, Description: c.Description,
			ArgumentHint: c.ArgumentHint, Builtin: c.Builtin, Handling: h})
	}
	return out
}

// initCommands reads initialize's answer, if line is it: the commands.
func initCommands(line []byte) ([]agent.Command, bool) {
	var e struct {
		Type     string `json:"type"`
		Response struct {
			RequestID string `json:"request_id"`
			Response  struct {
				Commands []command `json:"commands"`
			} `json:"response"`
		} `json:"response"`
	}
	if json.Unmarshal(line, &e) != nil || e.Type != "control_response" || e.Response.RequestID != "init" {
		return nil, false
	}
	return offered(e.Response.Response.Commands), true
}

// Commands: Claude Code tells them only from a session, as it starts.
func (a *Agent) Commands(context.Context, string) ([]agent.Command, error) {
	return nil, agent.ErrCommandsFromSession
}

// commandText is how Claude Code takes a turn invoking a command: at the
// start of the message, what follows after it.
func commandText(turn agent.Turn) string {
	if turn.Command == nil {
		return turn.Text
	}
	if turn.Text == "" {
		return "/" + turn.Command.Name
	}
	return "/" + turn.Command.Name + " " + turn.Text
}
