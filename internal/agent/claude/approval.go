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
	}
	json.Unmarshal(r.Input, &in)
	switch r.ToolName {
	case "Bash":
		a.Title, a.Command = "执行命令", in.Command
	case "Edit", "MultiEdit", "Write", "NotebookEdit":
		a.Title = "修改文件"
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
			a.Title = "调用 MCP 工具 " + r.ToolName
		} else {
			a.Title = "使用工具 " + r.ToolName
		}
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
	opts := []agent.ApprovalOption{{ID: optOnce, Kind: agent.AllowOnce, Label: "批准本次"}}
	var session, always []string
	var rules []agent.Rule
	where := ""
	for _, r := range raw {
		var s suggestion
		if json.Unmarshal(r, &s) != nil {
			continue
		}
		session = append(session, describe(s))
		rules = append(rules, agent.Rule{Label: describe(s), Data: r})
		if f, ok := settingsFiles[s.Destination]; ok && s.Type == "addRules" {
			always = append(always, describe(s))
			where = f
		}
	}
	if len(session) > 0 {
		opts = append(opts, agent.ApprovalOption{ID: optSession, Kind: agent.AllowSession, Label: "本会话内始终允许", Detail: session, Rules: rules})
	}
	if len(always) > 0 {
		opts = append(opts, agent.ApprovalOption{ID: optAlways, Kind: agent.AllowAlways, Label: "永久允许", Detail: always, Where: where})
	}
	return append(opts,
		agent.ApprovalOption{ID: optDeny, Kind: agent.Deny, Label: "拒绝"},
		agent.ApprovalOption{ID: optStop, Kind: agent.DenyStop, Label: "拒绝并停止"})
}

// describe says what a suggestion allows.
func describe(s suggestion) string {
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
		return strings.Join(rs, "、")
	case "setMode":
		if s.Mode == "acceptEdits" {
			return "自动接受修改"
		}
		return "切换到 " + s.Mode + " 模式"
	case "addDirectories":
		return "访问 " + strings.Join(s.Directories, "、")
	}
	return s.Type
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
		if note == "" {
			note = "用户拒绝了这个操作。"
		} else {
			note = "用户拒绝了这个操作：" + note
		}
		return map[string]any{"behavior": "deny", "message": note, "interrupt": optionID == optStop}, nil
	}
	return nil, errors.New("没有这个选项：" + optionID)
}

// modes are Claude Code's permission modes for the approval levels.
var modes = map[agent.ApprovalLevel]string{
	agent.AskAlways:   "manual",
	agent.AcceptEdits: "acceptEdits",
	agent.FullAuto:    "bypassPermissions",
}

// ruleArgs are the command line that applies a session's rules again:
// rules of tools allowed, directories added, and the permission mode a
// rule may raise the level's to.
func ruleArgs(level agent.ApprovalLevel, rules []agent.Rule) (mode string, allowed, dirs []string) {
	mode = modes[level]
	if mode == "" {
		mode = modes[agent.AskAlways]
	}
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
			if s.Mode == "acceptEdits" && mode == modes[agent.AskAlways] {
				mode = s.Mode
			}
		}
	}
	return mode, allowed, dirs
}
