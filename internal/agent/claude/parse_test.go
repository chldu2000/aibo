package claude

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

// replay is an Agent whose turns replay Claude Code's output recorded in
// testdata, through the real parser, one turn per result.
type replay struct {
	turns [][]string
}

func load(t *testing.T, name string) *replay {
	t.Helper()
	f, err := os.Open("testdata/" + name + ".jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r := &replay{}
	var turn []string
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		turn = append(turn, sc.Text())
		if strings.HasPrefix(sc.Text(), `{"type": "result"`) {
			r.turns, turn = append(r.turns, turn), nil
		}
	}
	return r
}

func (r *replay) Kind() agent.Kind            { return Kind }
func (r *replay) Name() string                { return "Claude Code" }
func (r *replay) ToolName(tool string) string { return "mcp__aibo__" + tool }

func (r *replay) Start(context.Context, agent.StartOptions) (agent.Session, error) {
	return &replaySession{r: r, p: newParser(), events: make(chan agent.Event, 1024)}, nil
}

type replaySession struct {
	r      *replay
	p      *parser
	n      int
	events chan agent.Event
}

func (s *replaySession) Events() <-chan agent.Event { return s.events }
func (s *replaySession) Send(context.Context, agent.Turn) error {
	for _, l := range s.r.turns[s.n] {
		for _, e := range s.p.line([]byte(l)) {
			s.events <- e
		}
	}
	s.n++
	return nil
}
func (s *replaySession) Interrupt(context.Context) error { return nil }
func (s *replaySession) Close() error                    { close(s.events); return nil }

// run sends one message per recorded turn and returns the session's
// messages.
func run(t *testing.T, name string, turns int) ([]model.Message, *workbench.Workbench, string) {
	t.Helper()
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{load(t, name)}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { w.Close() })
	ws, _ := w.AddWorkspace(t.TempDir())
	s, _ := w.NewSession(ws.ID, Kind, "")
	idle := make(chan struct{}, 100)
	w.Subscribe(func(workbench.Change) { idle <- struct{}{} })
	for i := 0; i < turns; i++ {
		if err := w.Send(s.ID, "turn"); err != nil {
			t.Fatal(err)
		}
		guard := time.After(time.Minute)
		for w.Status(s.ID).Running {
			select {
			case <-idle:
			case <-guard:
				t.Fatal("the turn never ended")
			}
		}
	}
	ms, err := w.Messages(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	return ms, w, s.ID
}

func TestToolsAndReplies(t *testing.T) {
	ms, w, id := run(t, "t1", 1)
	type item struct {
		kind  model.MessageKind
		state model.MessageState
		text  string // a reply's text, or a tool's name and output
	}
	var got []item
	for _, m := range ms {
		it := item{m.Kind, m.State, m.Text}
		if m.Tool != nil {
			it.text = m.Tool.Name + " → " + m.Tool.Output
		}
		got = append(got, it)
	}
	want := []item{
		{model.UserMessage, model.Done, "turn"},
		{model.ToolCall, model.Done, "ToolSearch → No matching deferred tools found"},
		{model.AgentReply, model.Done, "TodoWrite isn't available in this session, so I can't create that todo list. I'll read notes.txt now."},
		{model.ToolCall, model.Done, "Read → 1\thello\n2\tworld\n3\t"},
		{model.AgentReply, model.Done, "TodoWrite isn't available in this session, so I skipped the 2-item todo list; notes.txt contains \"hello\" and \"world\" on separate lines."},
	}
	if len(got) != len(want) {
		t.Fatalf("messages = %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("message %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	var in struct {
		FilePath string `json:"file_path"`
	}
	if json.Unmarshal(ms[3].Tool.Input, &in); in.FilePath != "/private/tmp/aibo-02/ws/notes.txt" {
		t.Errorf("Read's input = %s", ms[3].Tool.Input)
	}
	if x, _ := w.Session(id); x.NativeID() != "71b501e4-9795-4c35-afee-5f49ae856ccc" {
		t.Errorf("native session = %v", x.NativeIDs)
	}
	if st := w.Status(id); st.Error != "" {
		t.Errorf("error = %q", st.Error)
	}
}

func TestInterruptedTurnThenNext(t *testing.T) {
	ms, w, id := run(t, "int", 2)
	if len(ms) != 4 {
		t.Fatalf("%d messages: %+v", len(ms), ms)
	}
	if r := ms[1]; r.State != model.Interrupted || !strings.HasPrefix(r.Text, "1\n2\n3\n") {
		t.Errorf("interrupted reply = %v %q", r.State, r.Text)
	}
	if r := ms[3]; r.State != model.Done || r.Text != "OK" {
		t.Errorf("next reply = %v %q", r.State, r.Text)
	}
	// An interruption is not an error.
	if st := w.Status(id); st.Error != "" {
		t.Errorf("error = %q", st.Error)
	}
}

func TestSubagentNestsInItsCall(t *testing.T) {
	ms, _, _ := run(t, "sub", 1)
	var kinds []string
	for _, m := range ms {
		kinds = append(kinds, string(m.Kind))
	}
	if strings.Join(kinds, " ") != "user tool reply" {
		t.Fatalf("messages are %v", kinds)
	}
	call := ms[1]
	if call.Tool.Name != "Agent" || !call.Tool.Done || call.State != model.Done {
		t.Errorf("subagent call = %+v %+v", call, call.Tool)
	}
	if len(call.Children) != 2 {
		t.Fatalf("children = %+v", call.Children)
	}
	if c := call.Children[0]; c.Kind != model.ToolCall || c.Tool.Name != "Read" || c.Tool.Output != "1\thello" || c.State != model.Done {
		t.Errorf("child tool = %+v %+v", c, c.Tool)
	}
	if c := call.Children[1]; c.Kind != model.AgentReply || !strings.Contains(c.Text, "hello") || c.State != model.Done {
		t.Errorf("child reply = %+v", c)
	}
	if !strings.Contains(ms[2].Text, `"hello"`) {
		t.Errorf("final reply = %q", ms[2].Text)
	}
}

func TestTodoWriteIsAPlanAndThinkingAttaches(t *testing.T) {
	p := newParser()
	lines := []string{
		`{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1"}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"想一想"}}}`,
		`{"type":"assistant","message":{"id":"m1","content":[{"type":"thinking","thinking":"想一想再说"}]}}`,
		`{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"读","status":"completed"},{"content":"写","status":"in_progress"}]}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":[{"type":"text","text":"a"},{"type":"image"}],"is_error":true}]}}`,
		`{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["too many turns"]}`,
	}
	var evs []agent.Event
	for _, l := range lines {
		evs = append(evs, p.line([]byte(l))...)
	}
	want := []agent.Event{
		agent.ThinkingDelta{ReplyID: "m1#0", Text: "想一想"},
		agent.ThinkingDelta{ReplyID: "m1#0", Text: "再说"},
		agent.PlanUpdated{PlanID: "todos", Items: []agent.PlanItem{{Text: "读", Status: agent.PlanCompleted}, {Text: "写", Status: agent.PlanInProgress}}},
		agent.ToolFinished{ToolID: "t2", Output: "a\n[图片]", IsError: true},
		agent.Failed{Message: "Claude Code 出错：too many turns"},
		agent.TurnEnded{},
	}
	if len(evs) != len(want) {
		t.Fatalf("events = %#v", evs)
	}
	for i := range want {
		g := evs[i]
		switch e := g.(type) {
		case agent.PlanUpdated:
			e.Raw = nil
			g = e
		case agent.ToolFinished:
			e.Raw = nil
			g = e
		}
		if gs, ws := strings.ReplaceAll(sprint(g), " ", ""), strings.ReplaceAll(sprint(want[i]), " ", ""); gs != ws {
			t.Errorf("event %d = %s, want %s", i, gs, ws)
		}
	}
}

func sprint(e agent.Event) string { return fmt.Sprintf("%#v", e) }

func (s *replaySession) RespondApproval(context.Context, string, string, string) error { return nil }

func (s *replaySession) SetLevel(context.Context, agent.ApprovalLevel) error { return nil }
