package codex

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// thread turns the app-server's notifications about one thread into the
// workbench's events.
//
// Codex's reasoning is an item of its own; its text becomes the thinking
// of the reply that follows it in the turn, or a reply of its own when
// none follows.
type thread struct {
	reasoning   strings.Builder // not yet attached to a reply
	reasoningID string
	replies     map[string]bool // replies started, by item ID
	// files are the file changes started, by item ID, for their
	// approval requests to show.
	files map[string]item
	// compacting is set while a compaction asked for runs.
	compacting bool
	// loggedOut is set once the turn found Codex signed out.
	loggedOut bool
}

func newThread() *thread { return &thread{replies: map[string]bool{}, files: map[string]item{}} }

// item is the part of a ThreadItem the workbench reads.
type item struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Text string `json:"text"`
	// reasoning
	Summary []string `json:"summary"`
	Content []string `json:"content"`
	// commandExecution
	Command          string  `json:"command"`
	Cwd              string  `json:"cwd"`
	AggregatedOutput *string `json:"aggregatedOutput"`
	ExitCode         *int    `json:"exitCode"`
	Status           string  `json:"status"`
	// fileChange
	Changes []struct {
		Path string `json:"path"`
		Diff string `json:"diff"`
		Kind struct {
			Type string `json:"type"`
		} `json:"kind"`
	} `json:"changes"`
	// mcpToolCall, dynamicToolCall
	Server    string          `json:"server"`
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	Result    *struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"result"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
	ContentItems []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"contentItems"`
	Success *bool `json:"success"`
	// webSearch
	Query string `json:"query"`
	// collabAgentToolCall
	Prompt string `json:"prompt"`
}

type notification struct {
	Item        item   `json:"item"`
	ItemID      string `json:"itemId"`
	Delta       string `json:"delta"`
	TurnID      string `json:"turnId"`
	Explanation string `json:"explanation"`
	Plan        []struct {
		Step   string `json:"step"`
		Status string `json:"status"`
	} `json:"plan"`
	Turn struct {
		Status string `json:"status"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	} `json:"turn"`
	Error *struct {
		Message        string          `json:"message"`
		CodexErrorInfo json.RawMessage `json:"codexErrorInfo"`
	} `json:"error"`
	WillRetry bool `json:"willRetry"`
}

// unauthorized matches an error's info of a 401: Codex signed out.
var unauthorized = regexp.MustCompile(`"httpStatusCode"\s*:\s*401\b`)

// tool is a tool call item's name and input, or ok false for items that
// are not tool calls.
func tool(it item) (name string, input any, ok bool) {
	switch it.Type {
	case "commandExecution":
		return "shell", map[string]any{"command": it.Command, "cwd": it.Cwd}, true
	case "fileChange":
		var paths []string
		for _, c := range it.Changes {
			paths = append(paths, c.Kind.Type+" "+c.Path)
		}
		return "apply_patch", map[string]any{"changes": paths}, true
	case "mcpToolCall":
		return it.Server + "." + it.Tool, it.Arguments, true
	case "dynamicToolCall":
		return it.Tool, it.Arguments, true
	case "webSearch":
		return "web_search", map[string]any{"query": it.Query}, true
	case "collabAgentToolCall":
		return "agent", map[string]any{"prompt": it.Prompt}, true
	}
	return "", nil, false
}

// result is a finished tool call item's output, and whether it failed.
func result(it item) (string, bool) {
	switch it.Type {
	case "commandExecution":
		out := ""
		if it.AggregatedOutput != nil {
			out = *it.AggregatedOutput
		}
		failed := it.Status == "failed" || it.Status == "declined" || it.ExitCode != nil && *it.ExitCode != 0
		if it.Status == "declined" && out == "" {
			out = "（命令被拒绝执行）"
		}
		return out, failed
	case "fileChange":
		var b strings.Builder
		for _, c := range it.Changes {
			b.WriteString(c.Diff)
			if !strings.HasSuffix(c.Diff, "\n") {
				b.WriteString("\n")
			}
		}
		out := b.String()
		if it.Status == "declined" {
			out = "（修改被拒绝）\n" + out
		}
		return out, it.Status == "failed" || it.Status == "declined"
	case "mcpToolCall":
		if it.Error != nil {
			return it.Error.Message, true
		}
		var parts []string
		if it.Result != nil {
			for _, c := range it.Result.Content {
				if c.Type == "text" {
					parts = append(parts, c.Text)
				}
			}
		}
		return strings.Join(parts, "\n"), it.Status == "failed"
	case "dynamicToolCall":
		var parts []string
		for _, c := range it.ContentItems {
			parts = append(parts, c.Text)
		}
		return strings.Join(parts, "\n"), it.Success != nil && !*it.Success
	}
	return "", it.Status == "failed"
}

// handle maps one notification of the thread to events.
func (t *thread) handle(method string, params json.RawMessage) []agent.Event {
	var n notification
	if json.Unmarshal(params, &n) != nil {
		return nil
	}
	switch method {
	case "item/agentMessage/delta":
		if n.Delta == "" {
			return nil
		}
		out := t.attach(n.ItemID)
		t.replies[n.ItemID] = true
		return append(out, agent.ReplyDelta{ReplyID: n.ItemID, Text: n.Delta})
	case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
		t.reasoning.WriteString(n.Delta)
		t.reasoningID = n.ItemID
	case "item/started":
		if n.Item.Type == "fileChange" {
			t.files[n.Item.ID] = n.Item
		}
		if name, input, ok := tool(n.Item); ok {
			b, _ := json.Marshal(input)
			return []agent.Event{agent.ToolStarted{ToolID: n.Item.ID, Name: name, Input: b, Raw: params}}
		}
	case "item/completed":
		return t.completed(n.Item, params)
	case "turn/plan/updated":
		items := make([]agent.PlanItem, len(n.Plan))
		for i, s := range n.Plan {
			st := agent.PlanPending
			switch s.Status {
			case "inProgress":
				st = agent.PlanInProgress
			case "completed":
				st = agent.PlanCompleted
			}
			items[i] = agent.PlanItem{Text: s.Step, Status: st}
		}
		return []agent.Event{agent.PlanUpdated{PlanID: n.TurnID, Items: items, Raw: params}}
	case "error":
		if n.Error != nil && unauthorized.Match(n.Error.CodexErrorInfo) {
			// Signed out: no use waiting for its retries.
			if t.loggedOut {
				return nil
			}
			t.loggedOut = true
			return []agent.Event{agent.NotLoggedIn{}, agent.Failed{Message: "Codex 未登录。请在设置的“Agent”页登录，然后重新发送。"}}
		}
		if n.Error != nil && !n.WillRetry {
			return []agent.Event{agent.Failed{Message: "Codex 出错：" + n.Error.Message}}
		}
	case "turn/completed":
		clear(t.files)
		t.compacting, t.loggedOut = false, false
		out := t.flushReasoning()
		switch n.Turn.Status {
		case "interrupted":
			return append(out, agent.TurnEnded{Interrupted: true})
		case "failed":
			msg := "Codex 出错"
			if n.Turn.Error != nil {
				msg += "：" + n.Turn.Error.Message
			}
			out = append(out, agent.Failed{Message: msg})
		}
		return append(out, agent.TurnEnded{})
	}
	return nil
}

func (t *thread) completed(it item, raw json.RawMessage) []agent.Event {
	switch it.Type {
	case "agentMessage":
		out := t.attach(it.ID)
		if it.Text == "" && !t.replies[it.ID] {
			return out
		}
		delete(t.replies, it.ID)
		return append(out, agent.ReplyDone{ReplyID: it.ID, Text: it.Text, Raw: raw})
	case "plan":
		// A proposed plan's text: a reply of its own.
		if it.Text == "" {
			return nil
		}
		return []agent.Event{agent.ReplyDone{ReplyID: it.ID, Text: it.Text, Raw: raw}}
	case "contextCompaction":
		trigger := "auto"
		if t.compacting {
			trigger = "manual"
		}
		// Codex does not say how many tokens.
		return []agent.Event{agent.Compacted{Trigger: trigger}}
	case "reasoning":
		if t.reasoning.Len() == 0 {
			// Not streamed: its text is in the item.
			t.reasoning.WriteString(strings.Join(append(it.Summary, it.Content...), "\n\n"))
			t.reasoningID = it.ID
		}
		return nil
	}
	if _, _, ok := tool(it); ok {
		out, failed := result(it)
		return []agent.Event{agent.ToolFinished{ToolID: it.ID, Output: out, IsError: failed, Raw: raw}}
	}
	return nil
}

// attach gives the reasoning so far to the reply replyID.
func (t *thread) attach(replyID string) []agent.Event {
	if t.reasoning.Len() == 0 {
		return nil
	}
	text := t.reasoning.String()
	t.reasoning.Reset()
	return []agent.Event{agent.ThinkingDelta{ReplyID: replyID, Text: text}}
}

// flushReasoning makes reasoning no reply followed a reply of its own.
func (t *thread) flushReasoning() []agent.Event {
	if t.reasoning.Len() == 0 {
		return nil
	}
	id := t.reasoningID
	out := t.attach(id)
	return append(out, agent.ReplyDone{ReplyID: id})
}
