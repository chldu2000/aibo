package claude

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

// parser turns Claude Code's stream-json output, line by line, into the
// workbench's events.
//
// The session's own messages stream: stream_event deltas, then an
// assistant event per content block with the block whole. Text and
// thinking between tool calls make one reply, keyed by the API message's
// ID and how many tool calls came before in it. A subagent's messages
// (parent_tool_use_id) come only whole.
type parser struct {
	msg string // the API message streaming
	seg int    // tool calls so far in msg
	// started are the tool calls whose blocks started streaming, which
	// counted in seg already.
	started map[string]bool
	// thought is the reasoning streamed per reply.
	thought map[string]string
	// plans are the tool calls that were plans (TodoWrite), whose results
	// are not shown.
	plans map[string]bool
	// child counts a subagent's messages, to key them.
	child int
	// interrupting is set when the turn was asked to stop.
	interrupting bool
	// loggedOut is set when the turn found Claude Code signed out.
	loggedOut bool
	// asks are the can_use_tool requests waiting for an answer, by their
	// request IDs.
	asks map[string]canUseTool
	// held is the end of the reply streaming, until its block stops: an
	// interruption comes between its whole text and its stop, and leaves
	// it unfinished.
	held []agent.Event
}

// interruptedNote is the user message Claude Code adds when a turn is
// interrupted.
const interruptedNote = "[Request interrupted by user]"

func newParser() *parser {
	return &parser{started: map[string]bool{}, thought: map[string]string{}, plans: map[string]bool{}, asks: map[string]canUseTool{}}
}

type envelope struct {
	Type            string          `json:"type"`
	Subtype         string          `json:"subtype"`
	SessionID       string          `json:"session_id"`
	ParentToolUseID string          `json:"parent_tool_use_id"`
	Event           json.RawMessage `json:"event"`
	Message         json.RawMessage `json:"message"`
	// result
	IsError        bool     `json:"is_error"`
	Result         string   `json:"result"`
	Errors         []string `json:"errors"`
	TerminalReason string   `json:"terminal_reason"`
	// system/compact_boundary
	CompactMetadata struct {
		Trigger    string `json:"trigger"`
		PreTokens  int    `json:"pre_tokens"`
		PostTokens int    `json:"post_tokens"`
	} `json:"compact_metadata"`
	// assistant: "authentication_failed" on the message Claude Code makes
	// up when signed out; system/api_retry: what went wrong
	Error string `json:"error"`
	// system/api_retry
	Attempt     int  `json:"attempt"`
	MaxRetries  int  `json:"max_retries"`
	ErrorStatus *int `json:"error_status"`
	// control_request
	RequestID string          `json:"request_id"`
	Request   json.RawMessage `json:"request"`
	// control_response
	Response json.RawMessage `json:"response"`
	// system/init
	PermissionMode string `json:"permissionMode"`
}

type streamEvent struct {
	Type    string `json:"type"`
	Message struct {
		ID string `json:"id"`
	} `json:"message"`
	ContentBlock block `json:"content_block"`
	Delta        struct {
		Type     string `json:"type"`
		Text     string `json:"text"`
		Thinking string `json:"thinking"`
	} `json:"delta"`
}

type block struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	Text      string          `json:"text"`
	Thinking  string          `json:"thinking"`
	ToolUseID string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"`
	IsError   bool            `json:"is_error"`
}

type message struct {
	ID      string          `json:"id"`
	Content json.RawMessage `json:"content"`
}

func (p *parser) reply() string { return fmt.Sprintf("%s#%d", p.msg, p.seg) }

// line parses one line of output.
func (p *parser) line(raw []byte) []agent.Event {
	var e envelope
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil // not an event: Claude Code's own noise
	}
	if e.Type == "user" && p.held != nil && strings.Contains(string(e.Message), interruptedNote) {
		p.held = nil // the reply was cut short
	}
	var out []agent.Event
	if e.Type != "stream_event" || e.ParentToolUseID != "" {
		out, p.held = p.held, nil
	}
	return append(out, p.event(e, raw)...)
}

func (p *parser) event(e envelope, raw []byte) []agent.Event {
	switch e.Type {
	case "system":
		if e.Subtype == "init" && e.SessionID != "" {
			out := []agent.Event{agent.NativeSessionStarted{ID: e.SessionID}}
			// The mode as the turn starts: the Agent may have changed it,
			// leaving plan mode once its plan was approved.
			if e.PermissionMode != "" {
				out = append(out, agent.ModeReported{ID: e.PermissionMode})
			}
			return out
		}
		if e.Subtype == "api_retry" {
			msg := fmt.Sprintf("第 %d/%d 次重试", e.Attempt, e.MaxRetries)
			switch {
			case e.ErrorStatus != nil && e.Error != "":
				msg += fmt.Sprintf("（%d %s）", *e.ErrorStatus, e.Error)
			case e.Error != "":
				msg += "（" + e.Error + "）"
			}
			return []agent.Event{agent.Retrying{Message: msg}}
		}
		if e.Subtype == "compact_boundary" {
			m := e.CompactMetadata
			return []agent.Event{agent.Compacted{Trigger: m.Trigger, PreTokens: m.PreTokens, PostTokens: m.PostTokens}}
		}
	case "stream_event":
		if e.ParentToolUseID == "" {
			return p.stream(e.Event)
		}
	case "assistant":
		return p.assistant(e, raw)
	case "user":
		return p.user(e, raw)
	case "result":
		return p.result(e)
	case "control_response":
		// Only get_settings' answers say anything: what the session uses.
		// The others (initialize, set_model, interrupt…) only acknowledge.
		var r struct {
			RequestID string `json:"request_id"`
			Response  struct {
				Applied *struct {
					Model  string `json:"model"`
					Effort string `json:"effort"`
				} `json:"applied"`
			} `json:"response"`
		}
		if json.Unmarshal(e.Response, &r) == nil && strings.HasPrefix(r.RequestID, settingsReq) && r.Response.Applied != nil {
			return []agent.Event{agent.SettingsReported{Model: r.Response.Applied.Model, Effort: r.Response.Applied.Effort}}
		}
	case "control_request":
		var r struct {
			Subtype string `json:"subtype"`
			canUseTool
		}
		if json.Unmarshal(e.Request, &r) == nil && r.Subtype == "can_use_tool" {
			p.asks[e.RequestID] = r.canUseTool
			return []agent.Event{approval(e.RequestID, r.canUseTool)}
		}
	}
	return nil
}

func (p *parser) stream(raw json.RawMessage) []agent.Event {
	var se streamEvent
	if json.Unmarshal(raw, &se) != nil {
		return nil
	}
	switch se.Type {
	case "message_start":
		p.msg, p.seg = se.Message.ID, 0
	case "content_block_stop":
		out := p.held
		p.held = nil
		return out
	case "content_block_start":
		if se.ContentBlock.Type == "tool_use" {
			p.seg++
			p.started[se.ContentBlock.ID] = true
		}
	case "content_block_delta":
		switch se.Delta.Type {
		case "text_delta":
			if se.Delta.Text != "" {
				return []agent.Event{agent.ReplyDelta{ReplyID: p.reply(), Text: se.Delta.Text}}
			}
		case "thinking_delta":
			if se.Delta.Thinking != "" {
				p.thought[p.reply()] += se.Delta.Thinking
				return []agent.Event{agent.ThinkingDelta{ReplyID: p.reply(), Text: se.Delta.Thinking}}
			}
		}
	}
	return nil
}

func blocks(content json.RawMessage) []block {
	var bs []block
	if json.Unmarshal(content, &bs) == nil {
		return bs
	}
	var text string
	if json.Unmarshal(content, &text) == nil && text != "" {
		return []block{{Type: "text", Text: text}}
	}
	return nil
}

func (p *parser) assistant(e envelope, raw []byte) []agent.Event {
	if e.Error == "authentication_failed" {
		// Not a reply: Claude Code's "Not logged in · Please run /login".
		p.loggedOut = true
		return []agent.Event{agent.NotLoggedIn{}}
	}
	var m message
	if json.Unmarshal(e.Message, &m) != nil {
		return nil
	}
	parent := e.ParentToolUseID
	var out []agent.Event
	if parent == "" && m.ID != p.msg {
		// Not streamed (or the stream lost its start): key by this message.
		p.msg, p.seg = m.ID, 0
	}
	for _, b := range blocks(m.Content) {
		switch b.Type {
		case "text":
			if parent != "" {
				p.child++
				out = append(out, agent.ReplyDone{ReplyID: fmt.Sprintf("%s#%d", m.ID, p.child), Parent: parent, Text: b.Text})
				continue
			}
			if b.Text != "" {
				p.held = append(p.held, agent.ReplyDone{ReplyID: p.reply(), Text: b.Text, Raw: raw})
			}
		case "thinking":
			if b.Thinking == "" {
				continue
			}
			if parent != "" {
				p.child++
				out = append(out, agent.ThinkingDelta{ReplyID: fmt.Sprintf("%s#%d", m.ID, p.child), Parent: parent, Text: b.Thinking})
				continue
			}
			if rest, ok := strings.CutPrefix(b.Thinking, p.thought[p.reply()]); ok && rest != "" {
				p.thought[p.reply()] = b.Thinking
				out = append(out, agent.ThinkingDelta{ReplyID: p.reply(), Text: rest})
			}
		case "tool_use":
			if parent == "" && !p.started[b.ID] {
				p.seg++
			}
			if parent == "" && b.Name == "TodoWrite" {
				if items, ok := todos(b.Input); ok {
					p.plans[b.ID] = true
					out = append(out, agent.PlanUpdated{PlanID: "todos", Items: items, Raw: raw})
					continue
				}
			}
			out = append(out, agent.ToolStarted{ToolID: b.ID, Parent: parent, Name: b.Name, Input: b.Input, Raw: raw})
		}
	}
	return out
}

// todos reads TodoWrite's input as a plan.
func todos(input json.RawMessage) ([]agent.PlanItem, bool) {
	var in struct {
		Todos []struct {
			Content string `json:"content"`
			Status  string `json:"status"`
		} `json:"todos"`
	}
	if json.Unmarshal(input, &in) != nil || in.Todos == nil {
		return nil, false
	}
	items := make([]agent.PlanItem, len(in.Todos))
	for i, t := range in.Todos {
		st := agent.PlanPending
		switch t.Status {
		case "in_progress":
			st = agent.PlanInProgress
		case "completed":
			st = agent.PlanCompleted
		}
		items[i] = agent.PlanItem{Text: t.Content, Status: st}
	}
	return items, true
}

func (p *parser) user(e envelope, raw []byte) []agent.Event {
	var m message
	if json.Unmarshal(e.Message, &m) != nil {
		return nil
	}
	var out []agent.Event
	for _, b := range blocks(m.Content) {
		if b.Type != "tool_result" || p.plans[b.ToolUseID] {
			continue
		}
		out = append(out, agent.ToolFinished{ToolID: b.ToolUseID, Parent: e.ParentToolUseID, Output: resultText(b.Content), IsError: b.IsError, Raw: raw})
	}
	return out
}

// resultText is a tool result's content as text: a string, or blocks of
// text and images.
func resultText(content json.RawMessage) string {
	var s string
	if json.Unmarshal(content, &s) == nil {
		return s
	}
	var parts []string
	for _, b := range blocks(content) {
		switch b.Type {
		case "text":
			parts = append(parts, b.Text)
		case "image":
			parts = append(parts, "[图片]")
		}
	}
	return strings.Join(parts, "\n")
}

func (p *parser) result(e envelope) []agent.Event {
	// aborted_streaming: interrupted; aborted_tools: denied and stopped.
	interrupted := p.interrupting || strings.HasPrefix(e.TerminalReason, "aborted")
	var out []agent.Event
	if p.loggedOut {
		p.loggedOut = false
		return []agent.Event{agent.Failed{Message: "Claude Code 未登录。请在终端里运行 claude 登录，然后点“重试”。"}, agent.TurnEnded{}}
	}
	if e.IsError && !interrupted {
		msg := e.Result
		if msg == "" {
			msg = strings.Join(e.Errors, "\n")
		}
		if msg == "" {
			msg = e.Subtype
		}
		out = append(out, agent.Failed{Message: "Claude Code 出错：" + msg})
	}
	out = append(out, agent.TurnEnded{Interrupted: interrupted})
	p.interrupting = false
	p.child = 0
	clear(p.started)
	clear(p.thought)
	clear(p.asks)
	return out
}
