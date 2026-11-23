package claude

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// canUseTool is the control protocol's can_use_tool request: Claude Code
// asking to run a tool, with the permission rules it would suggest.
type canUseTool struct {
	ToolName    string            `json:"tool_name"`
	Input       json.RawMessage   `json:"input"`
	Description string            `json:"description"`
	Suggestions []json.RawMessage `json:"permission_suggestions"`
	BlockedPath string            `json:"blocked_path"`
	ToolUseID   string            `json:"tool_use_id"`
}

// suggestion is the part of a permission suggestion aibo reads; the rest
// goes back to Claude Code as it came.
type suggestion struct {
	Type        string `json:"type"`
	Destination string `json:"destination"`
	Mode        string `json:"mode"`
	Rules       []struct {
		ToolName    string `json:"toolName"`
		RuleContent string `json:"ruleContent"`
	} `json:"rules"`
	Directories []string `json:"directories"`
}

// The options' IDs: what the response to Claude Code is.
const (
	optOnce    = "once"
	optSession = "session"
	optAlways  = "always"
	optDeny    = "deny"
	optStop    = "stop"
)

// settingsFiles are where Claude Code writes a permanent rule.
var settingsFiles = map[string]string{
	"localSettings":   ".claude/settings.local.json",
	"projectSettings": ".claude/settings.json",
	"userSettings":    "~/.claude/settings.json",
}

// approval maps a can_use_tool request to an approval request.
func approval(id string, r canUseTool) agent.ApprovalRequested {
	a := agent.ApprovalRequested{ID: id, ToolID: r.ToolUseID, Reason: r.Description}
	var in struct {
		Command  string `json:"command"`
		FilePath string `json:"file_path"`
		Notebook string `json:"notebook_path"`
		Content  string `json:"content"`
		Old      string `json:"old_string"`
		New      string `json:"new_string"`
		Edits    []struct {
			Old string `json:"old_string"`
			New string `json:"new_string"`
		} `json:"edits"`
		Plan string `json:"plan"`
	}
	json.Unmarshal(r.Input, &in)
	switch r.ToolName {
	case "ExitPlanMode":
		// Plan mode's end: the plan, which Claude Code acts on once it
		// is approved.
		a.Action, a.Plan = agent.ActionPlan, in.Plan
	case "Bash":
		a.Action, a.Command = agent.ActionCommand, in.Command
	case "Edit", "MultiEdit", "Write", "NotebookEdit":
		a.Action = agent.ActionEdit
		path := in.FilePath
		if path == "" {
			path = in.Notebook
		}
		a.Paths = []string{path}
		switch {
		case r.ToolName == "Write":
			a.Diff = diff(path, "", in.Content)
		case len(in.Edits) > 0:
			var parts []string
			for _, e := range in.Edits {
				parts = append(parts, diff(path, e.Old, e.New))
			}
			a.Diff = strings.Join(parts, "\n")
		default:
			a.Diff = diff(path, in.Old, in.New)
		}
	default:
		if strings.HasPrefix(r.ToolName, "mcp__") {
			a.Action = agent.ActionMCP
		} else {
			a.Action = agent.ActionTool
		}
		a.Tool = r.ToolName
		a.Input = r.Input
	}
	if r.BlockedPath != "" && len(a.Paths) == 0 {
		a.Paths = []string{r.BlockedPath}
	}
	a.Options = options(r.Suggestions)
	return a
}

// diff is a change of a file's text, as a unified diff without context.
func diff(path, old, new string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "--- %s\n+++ %s\n", path, path)
	for _, l := range lines(old) {
		b.WriteString("-" + l + "\n")
	}
	for _, l := range lines(new) {
		b.WriteString("+" + l + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func lines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

// options are Claude Code's own answers: once; for the session, its
// suggestions for the session; always, its suggested rules for a
// settings file; deny; deny and stop.
func options(raw []json.RawMessage) []agent.ApprovalOption {
	opts := []agent.ApprovalOption{{ID: optOnce, Kind: agent.AllowOnce}}
	var session, always []agent.Grant
	var rules []agent.Rule
	where := ""
	for _, r := range raw {
		var s suggestion
		if json.Unmarshal(r, &s) != nil {
			continue
		}
		session = append(session, grant(s))
		rules = append(rules, agent.Rule{Grant: grant(s), Data: r})
		if f, ok := settingsFiles[s.Destination]; ok && s.Type == "addRules" {
			always = append(always, grant(s))
			where = f
		}
	}
	if len(session) > 0 {
		opts = append(opts, agent.ApprovalOption{ID: optSession, Kind: agent.AllowSession, Grants: session, Rules: rules})
	}
	if len(always) > 0 {
		opts = append(opts, agent.ApprovalOption{ID: optAlways, Kind: agent.AllowAlways, Grants: always, Where: where})
	}
	return append(opts,
		agent.ApprovalOption{ID: optDeny, Kind: agent.Deny},
		agent.ApprovalOption{ID: optStop, Kind: agent.DenyStop})
}

// grant is what a suggestion allows.
func grant(s suggestion) agent.Grant {
	switch s.Type {
	case "addRules":
		var rs []string
		for _, r := range s.Rules {
			if r.RuleContent != "" {
				rs = append(rs, r.ToolName+"("+r.RuleContent+")")
			} else {
				rs = append(rs, r.ToolName)
			}
		}
		return agent.Grant{Kind: agent.GrantTools, Items: rs}
	case "setMode":
		if s.Mode == "acceptEdits" {
			return agent.Grant{Kind: agent.GrantAcceptEdits}
		}
		return agent.Grant{Kind: agent.GrantMode, Items: []string{s.Mode}}
	case "addDirectories":
		return agent.Grant{Kind: agent.GrantDirectories, Items: s.Directories}
	}
	return agent.Grant{Kind: agent.GrantKind(s.Type)}
}

// response is the control protocol's answer to a can_use_tool request
// for the option chosen.
func response(r canUseTool, optionID, note string) (map[string]any, error) {
	switch optionID {
	case optOnce:
		return map[string]any{"behavior": "allow", "updatedInput": r.Input}, nil
	case optSession, optAlways:
		var perms []map[string]any
		for _, raw := range r.Suggestions {
			var s map[string]any
			if json.Unmarshal(raw, &s) != nil {
				continue
			}
			if optionID == optSession {
				s["destination"] = "session"
			} else if _, ok := settingsFiles[fmt.Sprint(s["destination"])]; !ok || s["type"] != "addRules" {
				continue
			}
			perms = append(perms, s)
		}
		return map[string]any{"behavior": "allow", "updatedInput": r.Input, "updatedPermissions": perms}, nil
	case optDeny, optStop:
		note = denyNote(note)
		return map[string]any{"behavior": "deny", "message": note, "interrupt": optionID == optStop}, nil
	}
	return nil, errors.New("no such option: " + optionID)
}

// Modes are Claude Code's permission modes, in the order Shift+Tab goes
// through them; "manual" is only another name of "default".
var Modes = []agent.PermissionMode{
	{ID: "default", Name: "Manual", Description: "Asks before running commands or changing files", Risk: agent.Safe, Default: true},
	{ID: "acceptEdits", Name: "Accept edits", Description: "Changes files unasked; asks for the rest", Risk: agent.Caution},
	{ID: "plan", Name: "Plan", Description: "Read only: makes a plan, and acts once you approve it", Risk: agent.Safe, ReadOnly: true},
	{ID: "auto", Name: "Auto", Description: "A classifier decides; most actions go unasked", Risk: agent.Caution},
	{ID: "dontAsk", Name: "Don't Ask", Description: "Never asks: denies whatever was not allowed beforehand", Risk: agent.Safe},
	{ID: "bypassPermissions", Name: "Bypass Permissions", Description: "Asks for nothing, outside the workspace too", Risk: agent.Danger},
}

func knownMode(id string) bool {
	for _, m := range Modes {
		if m.ID == id {
			return true
		}
	}
	return false
}

// ruleArgs are the command line that applies a session's rules again:
// rules of tools allowed, directories added, and the permission mode a
// rule may raise the session's to; empty leaves Claude Code's own.
func ruleArgs(mode string, rules []agent.Rule) (string, []string, []string) {
	var allowed, dirs []string
	for _, r := range rules {
		var s suggestion
		if json.Unmarshal(r.Data, &s) != nil {
			continue
		}
		switch s.Type {
		case "addRules":
			for _, rule := range s.Rules {
				if rule.RuleContent != "" {
					allowed = append(allowed, rule.ToolName+"("+rule.RuleContent+")")
				} else {
					allowed = append(allowed, rule.ToolName)
				}
			}
		case "addDirectories":
			dirs = append(dirs, s.Directories...)
		case "setMode":
			if s.Mode == "acceptEdits" && (mode == "" || mode == "default") {
				mode = s.Mode
			}
		}
	}
	return mode, allowed, dirs
}
