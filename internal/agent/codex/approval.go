package codex

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// ask is an approval request of the app-server, waiting for an answer.
type ask struct {
	rpcID  json.RawMessage
	method string
	// amendment is the execpolicy rule Codex proposed, for "always".
	amendment []string
}

type askParams struct {
	ItemID    string   `json:"itemId"`
	Command   string   `json:"command"`
	Cwd       string   `json:"cwd"`
	Reason    string   `json:"reason"`
	Amendment []string `json:"proposedExecpolicyAmendment"`
	GrantRoot string   `json:"grantRoot"`
	// mcpServer/elicitation/request
	ServerName string `json:"serverName"`
	Message    string `json:"message"`
}

// Methods of the app-server's approval requests.
const (
	askCommand     = "item/commandExecution/requestApproval"
	askFileChange  = "item/fileChange/requestApproval"
	askElicitation = "mcpServer/elicitation/request"
)

// approval maps an approval request to the workbench's, with Codex's own
// answers.
func (t *thread) approval(id, method string, params json.RawMessage) (agent.ApprovalRequested, ask, bool) {
	var p askParams
	if json.Unmarshal(params, &p) != nil {
		return agent.ApprovalRequested{}, ask{}, false
	}
	a := agent.ApprovalRequested{ID: id, ToolID: p.ItemID, Reason: p.Reason}
	k := ask{method: method}
	once := agent.ApprovalOption{ID: "accept", Kind: agent.AllowOnce, Label: "批准本次"}
	session := agent.ApprovalOption{ID: "acceptForSession", Kind: agent.AllowSession, Label: "本会话内始终允许"}
	deny := agent.ApprovalOption{ID: "decline", Kind: agent.Deny, Label: "拒绝"}
	stop := agent.ApprovalOption{ID: "cancel", Kind: agent.DenyStop, Label: "拒绝并停止"}
	switch method {
	case askCommand:
		a.Title, a.Command, a.Cwd = "执行命令", p.Command, p.Cwd
		session.Rules = []agent.Rule{commandRule(p.Command)}
		a.Options = []agent.ApprovalOption{once, session}
		if len(p.Amendment) > 0 {
			k.amendment = p.Amendment
			a.Options = append(a.Options, agent.ApprovalOption{ID: "always", Kind: agent.AllowAlways,
				Label: "永久允许（以 " + strings.Join(p.Amendment, " ") + " 开头的命令）", Where: "Codex 的执行策略规则"})
		}
		a.Options = append(a.Options, deny, stop)
	case askFileChange:
		a.Title = "修改文件"
		if p.GrantRoot != "" {
			a.Reason = strings.TrimSpace(a.Reason + "（请求在本会话内允许写入 " + p.GrantRoot + "）")
			a.Paths = append(a.Paths, p.GrantRoot)
		}
		if it, ok := t.files[p.ItemID]; ok {
			var diffs []string
			for _, c := range it.Changes {
				a.Paths = append(a.Paths, c.Path)
				diffs = append(diffs, "--- "+c.Path+"\n+++ "+c.Path+"\n"+strings.TrimRight(c.Diff, "\n"))
			}
			a.Diff = strings.Join(diffs, "\n")
		}
		session.Rules = []agent.Rule{filesRule(a.Paths)}
		a.Options = []agent.ApprovalOption{once, session, deny, stop}
	case askElicitation:
		a.Title = "调用 MCP 工具（" + p.ServerName + "）"
		a.Reason = p.Message
		a.Input = params
		a.Options = []agent.ApprovalOption{once, deny, stop}
	default:
		return agent.ApprovalRequested{}, ask{}, false
	}
	return a, k, true
}

// result is the answer to an approval request for the option chosen.
func (k ask) result(optionID string) (any, error) {
	if k.method == askElicitation {
		switch optionID {
		case "accept", "decline", "cancel":
			return map[string]any{"action": optionID}, nil
		}
		return nil, errors.New("没有这个选项：" + optionID)
	}
	switch optionID {
	case "accept", "acceptForSession", "decline", "cancel":
		return map[string]any{"decision": optionID}, nil
	case "always":
		if len(k.amendment) > 0 {
			return map[string]any{"decision": map[string]any{"acceptWithExecpolicyAmendment": map[string]any{"execpolicy_amendment": k.amendment}}}, nil
		}
	}
	return nil, errors.New("没有这个选项：" + optionID)
}

// rule is what a session rule of Codex allows: a command as it was run,
// or changes to some files.
type rule struct {
	Kind    string   `json:"kind"` // "command" or "files"
	Command string   `json:"command,omitempty"`
	Paths   []string `json:"paths,omitempty"`
}

func commandRule(cmd string) agent.Rule {
	b, _ := json.Marshal(rule{Kind: "command", Command: cmd})
	return agent.Rule{Label: "命令 " + cmd, Data: b}
}

func filesRule(paths []string) agent.Rule {
	b, _ := json.Marshal(rule{Kind: "files", Paths: paths})
	return agent.Rule{Label: "修改 " + strings.Join(paths, "、"), Data: b}
}

// allowed reports whether a session rule allows the request, which Codex
// itself forgot when its thread started again.
func allowed(rules []agent.Rule, a agent.ApprovalRequested, method string) bool {
	for _, r := range rules {
		var x rule
		if json.Unmarshal(r.Data, &x) != nil {
			continue
		}
		switch {
		case method == askCommand && x.Kind == "command" && x.Command == a.Command:
			return true
		case method == askFileChange && x.Kind == "files" && len(a.Paths) > 0 && subset(a.Paths, x.Paths):
			return true
		}
	}
	return false
}

func subset(a, b []string) bool {
	for _, p := range a {
		found := false
		for _, q := range b {
			found = found || p == q
		}
		if !found {
			return false
		}
	}
	return true
}
