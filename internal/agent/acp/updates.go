package acp

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
)

type toolCall struct {
	ToolCallID, Title, Kind, Status string
	RawInput, RawOutput             json.RawMessage
	Locations                       []struct{ Path string }
	Content                         []struct {
		Type, Path, NewText string
		Content             struct{ Type, Text string }
	}
}

func (s *session) finishReply() {
	if s.reply != "" {
		s.emit(agent.ReplyDone{ReplyID: s.reply})
		s.reply, s.unnamed = "", false
	}
}

// interrupt ends a reply aibo named, before a tool call or a plan: the
// text the Agent writes after it is another reply, which shows after
// them. A reply the Agent named itself (messageId) goes on as it says.
func (s *session) interrupt() {
	s.segment++
	if s.unnamed {
		s.finishReply()
	}
}
func (s *session) update(raw json.RawMessage, active int) {
	var u struct {
		SessionUpdate, MessageID, CurrentModeID string
		Content                                 struct{ Type, Text string }
		ConfigOptions                           []configOption
		Entries                                 []struct{ Content, Status string }
	}
	// Tool content is an array; decode its own schema below.
	var tag struct{ SessionUpdate string }
	if json.Unmarshal(raw, &tag) != nil {
		return
	}
	switch tag.SessionUpdate {
	case "tool_call", "tool_call_update":
		if active != 0 {
			s.tool(raw)
		}
		return
	case "config_option_update":
		if json.Unmarshal(raw, &u) == nil {
			s.replace(u.ConfigOptions)
			s.report()
		}
		return
	case "current_mode_update":
		if json.Unmarshal(raw, &u) == nil {
			s.modeChanged(u.CurrentModeID)
		}
		return
	case "available_commands_update", "session_info_update", "usage_update", "user_message_chunk":
		// Commands have no workbench equivalent. Usage, metadata
		// and user echoes are not timeline messages.
		return
	case "plan", "agent_message_chunk", "agent_thought_chunk":
	default:
		s.log.Debug("unknown ACP session update", "shape", agent.Shape(raw), "type", tag.SessionUpdate)
		return
	}
	if active == 0 || json.Unmarshal(raw, &u) != nil {
		return
	}
	if u.SessionUpdate == "plan" {
		s.interrupt()
		p := agent.PlanUpdated{PlanID: "plan-" + strconv.Itoa(active), Raw: raw}
		for _, e := range u.Entries {
			p.Items = append(p.Items, agent.PlanItem{Text: e.Content, Status: agent.PlanStatus(e.Status)})
		}
		s.emit(p)
		return
	}
	if u.Content.Type != "text" {
		s.log.Debug("unsupported ACP reply content", "type", u.Content.Type)
		return
	}
	// Without a messageId (optional in ACP v1, as the Cursor CLI leaves
	// it), the text between tool calls is one reply.
	id, unnamed := u.MessageID, u.MessageID == ""
	if unnamed {
		id = "turn-" + strconv.Itoa(active) + "-" + strconv.Itoa(s.segment)
	}
	if s.reply != id {
		s.finishReply()
		s.reply, s.unnamed = id, unnamed
	}
	if u.SessionUpdate == "agent_message_chunk" {
		s.emit(agent.ReplyDelta{ReplyID: id, Text: u.Content.Text, Raw: raw})
	} else {
		s.emit(agent.ThinkingDelta{ReplyID: id, Text: u.Content.Text})
	}
}
func (s *session) tool(raw json.RawMessage) {
	var t toolCall
	if json.Unmarshal(raw, &t) != nil || t.ToolCallID == "" {
		return
	}
	id := t.ToolCallID
	updated := agent.ToolUpdated{ToolID: id}
	if !s.tools[id] {
		s.tools[id] = true
		s.interrupt()
		s.emit(agent.ToolStarted{ToolID: id, Name: t.Title, Input: t.RawInput, Raw: raw})
	} else {
		updated.Name, updated.Input = t.Title, t.RawInput
	}
	var result struct {
		Output   string
		Metadata struct{ Exit *int }
	}
	_ = json.Unmarshal(t.RawOutput, &result)
	if result.Output == "" {
		var parts []string
		for _, c := range t.Content {
			switch c.Type {
			case "content":
				if c.Content.Text != "" {
					parts = append(parts, c.Content.Text)
				}
			case "diff":
				parts = append(parts, c.Path+"\n"+c.NewText)
			}
		}
		result.Output = strings.Join(parts, "\n")
	}
	if result.Output == "" && len(t.RawOutput) > 0 {
		result.Output = string(t.RawOutput)
	}
	hasOutput := t.Content != nil || len(t.RawOutput) > 0
	finished := t.Status == "completed" || t.Status == "failed"
	if !finished && hasOutput {
		updated.Output = &result.Output
	}
	if updated.Name != "" || len(updated.Input) > 0 || updated.Output != nil {
		s.emit(updated)
	}
	if !finished {
		return
	}
	s.mu.Lock()
	denied := s.declined[id]
	s.mu.Unlock()
	s.emit(agent.ToolFinished{ToolID: id, Output: result.Output, KeepStreamedOutput: !hasOutput, ExitCode: result.Metadata.Exit, IsError: t.Status == "failed", Declined: denied, Raw: raw})
}

type permission struct {
	rpcID   json.RawMessage
	tool    string
	choices map[string]agent.OptionKind
}

func (s *session) permission(m envelope) {
	var p struct {
		ToolCall toolCall
		Options  []struct{ OptionID, Kind, Name string }
	}
	if json.Unmarshal(m.Params, &p) != nil {
		s.answer(m.ID, "")
		return
	}
	tc := p.ToolCall
	a := agent.ApprovalRequested{ID: tc.ToolCallID + "/" + string(m.ID), ToolID: tc.ToolCallID, Tool: tc.Title, Input: tc.RawInput, Action: agent.ActionTool}
	var input struct{ Command, Cwd string }
	_ = json.Unmarshal(tc.RawInput, &input)
	switch tc.Kind {
	case "execute":
		a.Action, a.Command, a.Cwd = agent.ActionCommand, input.Command, input.Cwd
		if a.Command == "" {
			// The Cursor CLI asks without the input, titling the call with
			// the command in backticks.
			a.Command = tc.Title
			if t := tc.Title; len(t) > 2 && t[0] == '`' && t[len(t)-1] == '`' && !strings.Contains(t[1:len(t)-1], "`") {
				a.Command = t[1 : len(t)-1]
			}
		}
	case "edit", "delete", "move":
		a.Action = agent.ActionEdit
	}
	for _, loc := range tc.Locations {
		a.Paths = append(a.Paths, loc.Path)
	}
	choices := map[string]agent.OptionKind{}
	for _, o := range p.Options {
		var kind agent.OptionKind
		switch o.Kind {
		case "allow_once":
			kind = agent.AllowOnce
		case "allow_always":
			kind = agent.AllowAlways
		case "reject_once":
			kind = agent.Deny
		case "reject_always":
			kind = agent.DenyAlways
		default:
			continue
		}
		if o.OptionID != "" {
			a.Options = append(a.Options, agent.ApprovalOption{ID: o.OptionID, Kind: kind, Label: o.Name, NoNote: kind.Denies()})
			choices[o.OptionID] = kind
		}
	}
	s.mu.Lock()
	if s.cancelling || len(choices) == 0 {
		s.mu.Unlock()
		s.answer(m.ID, "")
		return
	}
	s.pending[a.ID] = permission{rpcID: m.ID, tool: tc.ToolCallID, choices: choices}
	s.mu.Unlock()
	s.emit(a)
}
func (s *session) answer(id json.RawMessage, choice string) error {
	return s.answerContext(context.Background(), id, choice)
}
func (s *session) answerContext(ctx context.Context, id json.RawMessage, choice string) error {
	outcome := object{"outcome": "cancelled"}
	if choice != "" {
		outcome = object{"outcome": "selected", "optionId": choice}
	}
	return s.write(ctx, object{"id": id, "result": object{"outcome": outcome}})
}
func (s *session) RespondApproval(ctx context.Context, id, optionID, _ string) error {
	s.control.Lock()
	defer s.control.Unlock()
	s.mu.Lock()
	p, ok := s.pending[id]
	kind, allowed := p.choices[optionID]
	if !ok || !allowed {
		s.mu.Unlock()
		return errors.New("unknown ACP permission request or option")
	}
	delete(s.pending, id)
	if kind.Denies() {
		s.declined[p.tool] = true
	}
	s.mu.Unlock()
	return s.answerContext(ctx, p.rpcID, optionID)
}
func (s *session) Interrupt(ctx context.Context) error {
	s.control.Lock()
	defer s.control.Unlock()
	s.mu.Lock()
	if s.active == 0 {
		s.mu.Unlock()
		return nil
	}
	s.cancelling = true
	pending := s.pending
	s.pending = map[string]permission{}
	s.mu.Unlock()
	err := s.write(ctx, object{"method": "session/cancel", "params": object{"sessionId": s.id}})
	for _, p := range pending {
		err = errors.Join(err, s.answerContext(ctx, p.rpcID, ""))
	}
	return err
}
