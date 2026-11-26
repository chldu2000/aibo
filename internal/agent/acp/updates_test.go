package acp

import (
	"bufio"
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// Captured inbound frames of an allowed OpenCode 1.19.6 echo command.
func TestOpenCodeFrames(t *testing.T) {
	f, err := os.Open("testdata/opencode-1.19.6.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s := &session{active: 3, events: make(chan agent.Event, 32), id: "ses_deecb2940ffeb9bn7l3eRs0aFj", log: agent.Discard, pending: map[string]permission{}, tools: map[string]bool{}}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var m envelope
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatal(err)
		}
		if m.Method != "" {
			s.incoming(m)
		} else {
			s.response(m)
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	close(s.events)
	var tool string
	var asked, finished, done, ended bool
	var reply string
	for ev := range s.events {
		switch e := ev.(type) {
		case agent.ToolStarted:
			tool = e.ToolID
		case agent.ApprovalRequested:
			asked = e.ID == tool+"/0" && e.Command == "echo probe-allow" && len(e.Options) == 3 && e.ToolID == tool
		case agent.ToolFinished:
			finished = e.ToolID == tool && e.Output == "probe-allow\n" && e.ExitCode != nil && *e.ExitCode == 0 && !e.IsError
		case agent.ReplyDelta:
			reply += e.Text
		case agent.ReplyDone:
			done = true
		case agent.TurnEnded:
			ended = done && !e.Interrupted
		}
	}
	if tool == "" || !asked || !finished || reply != "probe-allow" || !ended {
		t.Fatalf("tool=%s asked=%v finished=%v reply=%q ended=%v", tool, asked, finished, reply, ended)
	}
}

// Replies the Agent names (messageId) are as it names them, a tool call
// between chunks of one going on with it, as OpenCode names them; replies
// it does not name end at a tool call or a plan.
func TestReplySegments(t *testing.T) {
	run := func(updates ...string) (steps []string) {
		s := &session{events: make(chan agent.Event, 64), log: agent.Discard, tools: map[string]bool{}}
		for _, u := range updates {
			s.update(json.RawMessage(u), 7)
		}
		s.finishReply()
		close(s.events)
		for ev := range s.events {
			switch e := ev.(type) {
			case agent.ReplyDelta:
				steps = append(steps, e.ReplyID+":"+e.Text)
			case agent.ReplyDone:
				steps = append(steps, "done "+e.ReplyID)
			case agent.ToolStarted:
				steps = append(steps, "tool")
			case agent.PlanUpdated:
				steps = append(steps, "plan")
			}
		}
		return steps
	}
	chunk := func(id, text string) string {
		if id == "" {
			return `{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"` + text + `"}}`
		}
		return `{"sessionUpdate":"agent_message_chunk","messageId":"` + id + `","content":{"type":"text","text":"` + text + `"}}`
	}
	tool := `{"sessionUpdate":"tool_call","toolCallId":"t1","title":"echo","kind":"execute","status":"pending"}`
	again := `{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"in_progress"}`
	plan := `{"sessionUpdate":"plan","entries":[{"content":"step","status":"pending"}]}`

	named := run(chunk("m1", "a"), tool, chunk("m1", "b"), chunk("m2", "c"))
	if want := []string{"m1:a", "tool", "m1:b", "done m1", "m2:c", "done m2"}; !slices.Equal(named, want) {
		t.Errorf("named\n got %q\nwant %q", named, want)
	}
	unnamed := run(chunk("", "a"), tool, again, chunk("", "b"), plan, chunk("", "c"))
	if want := []string{"turn-7-0:a", "done turn-7-0", "tool", "turn-7-1:b", "done turn-7-1", "plan", "turn-7-2:c", "done turn-7-2"}; !slices.Equal(unnamed, want) {
		t.Errorf("unnamed\n got %q\nwant %q", unnamed, want)
	}
}
