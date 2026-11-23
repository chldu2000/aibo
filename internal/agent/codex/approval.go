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
	once := agent.ApprovalOption{ID: "accept", Kind: agent.AllowOnce}
	session := agent.ApprovalOption{ID: "acceptForSession", Kind: agent.AllowSession}
	deny := agent.ApprovalOption{ID: "decline", Kind: agent.Deny}
	stop := agent.ApprovalOption{ID: "cancel", Kind: agent.DenyStop}
	switch method {
	case askCommand:
		a.Action, a.Command, a.Cwd = agent.ActionCommand, p.Command, p.Cwd
		session.Rules = []agent.Rule{commandRule(p.Command)}
		session.Grants = []agent.Grant{session.Rules[0].Grant}
		a.Options = []agent.ApprovalOption{once, session}
		if len(p.Amendment) > 0 {
			k.amendment = p.Amendment
			a.Options = append(a.Options, agent.ApprovalOption{ID: "always", Kind: agent.AllowAlways,
				Grants: []agent.Grant{{Kind: agent.GrantCommandPrefix, Items: p.Amendment}}})
		}
		a.Options = append(a.Options, deny, stop)
	case askFileChange:
		a.Action = agent.ActionEdit
		if p.GrantRoot != "" {
			a.WriteRoot = p.GrantRoot
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
		session.Grants = []agent.Grant{session.Rules[0].Grant}
		a.Options = []agent.ApprovalOption{once, session, deny, stop}
	case askElicitation:
		a.Action, a.Tool = agent.ActionMCP, p.ServerName
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
		return nil, errors.New("no such option: " + optionID)
	}
	switch optionID {
	case "accept", "acceptForSession", "decline", "cancel":
		return map[string]any{"decision": optionID}, nil
	case "always":
		if len(k.amendment) > 0 {
			return map[string]any{"decision": map[string]any{"acceptWithExecpolicyAmendment": map[string]any{"execpolicy_amendment": k.amendment}}}, nil
		}
	}
	return nil, errors.New("no such option: " + optionID)
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
	return agent.Rule{Grant: agent.Grant{Kind: agent.GrantCommand, Items: []string{cmd}}, Data: b}
}

func filesRule(paths []string) agent.Rule {
	b, _ := json.Marshal(rule{Kind: "files", Paths: paths})
	return agent.Rule{Grant: agent.Grant{Kind: agent.GrantEdits, Items: paths}, Data: b}
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
