package codex

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

// replay is an Agent whose turns replay notifications recorded from
// codex app-server 0.169.0 in testdata (or written for a test), through
// the real mapping, one turn per turn/completed.
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
	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	return replayOf(lines...)
}

func replayOf(lines ...string) *replay {
	r := &replay{}
	var turn []string
	for _, l := range lines {
		turn = append(turn, l)
		if strings.Contains(l, `"method": "turn/completed"`) || strings.Contains(l, `"method":"turn/completed"`) {
			r.turns, turn = append(r.turns, turn), nil
		}
	}
	return r
}

func (r *replay) Kind() agent.Kind            { return Kind }
func (r *replay) Name() string                { return "Codex" }
func (r *replay) ToolName(tool string) string { return tool }
func (r *replay) Start(context.Context, agent.StartOptions) (agent.Session, error) {
	return &replaySession{r: r, t: newThread(), events: make(chan agent.Event, 1024)}, nil
}

type replaySession struct {
	r      *replay
	t      *thread
	n      int
	events chan agent.Event
}

func (s *replaySession) Events() <-chan agent.Event { return s.events }
func (s *replaySession) Send(context.Context, agent.Turn) error {
	for _, l := range s.r.turns[s.n] {
		var m struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		json.Unmarshal([]byte(l), &m)
		for _, e := range s.t.handle(m.Method, m.Params) {
			s.events <- e
		}
	}
	s.n++
	return nil
}
func (s *replaySession) Interrupt(context.Context) error { return nil }
func (s *replaySession) Close() error                    { close(s.events); return nil }

func run(t *testing.T, r *replay) ([]model.Message, workbench.Status) {
	t.Helper()
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{r}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { w.Close() })
	ws, _ := w.AddWorkspace(t.TempDir())
	s, _ := w.NewSession(ws.ID, Kind, "")
	changed := make(chan struct{}, 1000)
	w.Subscribe(func(workbench.Change) { changed <- struct{}{} })
	for range r.turns {
		if err := w.Send(s.ID, "turn"); err != nil {
			t.Fatal(err)
		}
		guard := time.After(time.Minute)
		for w.Status(s.ID).Running {
			select {
			case <-changed:
			case <-guard:
				t.Fatal("the turn never ended")
			}
		}
	}
	ms, _ := w.Messages(s.ID)
	return ms, w.Status(s.ID)
}

func summary(ms []model.Message) []string {
	var out []string
	for _, m := range ms {
		s := fmt.Sprintf("%s %s %q", m.Kind, m.State, m.Text)
		if m.Tool != nil {
			s = fmt.Sprintf("%s %s %s → %q error=%v", m.Kind, m.State, m.Tool.Name, m.Tool.Output, m.Tool.IsError)
		}
		if m.Thinking != "" {
			s += fmt.Sprintf(" thinking=%q", m.Thinking)
		}
		out = append(out, s)
	}
	return out
}

func expect(t *testing.T, got []string, want ...string) {
	t.Helper()
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("messages:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestRecordedCommandThenInterrupt(t *testing.T) {
	ms, st := run(t, load(t, "t1"))
	got := summary(ms)
	if len(got) != 6 {
		t.Fatalf("messages:\n%s", strings.Join(got, "\n"))
	}
	expect(t, got[:5],
		`user done "turn"`,
		`reply done "1. Run `+"`cat notes.txt`"+` in the workspace.\n2. Summarize the file in one sentence."`,
		`tool done shell → "hello\nworld\n" error=false`,
		`reply done "The file says “hello” on the first line and “world” on the second."`,
		`user done "turn"`,
	)
	// The count, cut off by the interrupt.
	if r := ms[5]; r.Kind != model.AgentReply || r.State != model.Interrupted || !strings.HasPrefix(r.Text, "1\n2\n") {
		t.Errorf("interrupted reply = %s %q", r.State, r.Text)
	}
	if st.Error != "" {
		t.Errorf("error = %q", st.Error)
	}
	if string(ms[2].Tool.Input) != `{"command":"/bin/zsh -lc 'cat notes.txt'","cwd":"/tmp/aibo-03/ws"}` {
		t.Errorf("command input = %s", ms[2].Tool.Input)
	}
}

func TestRecordedCommandWritingAFile(t *testing.T) {
	ms, _ := run(t, load(t, "t2"))
	var tools int
	for _, m := range ms {
		if m.Kind == model.ToolCall {
			tools++
			if m.State != model.Done || m.Tool.Name != "shell" {
				t.Errorf("tool = %+v", m)
			}
		}
	}
	if tools != 1 || ms[len(ms)-1].Kind != model.AgentReply || ms[len(ms)-1].State != model.Done {
		t.Errorf("messages:\n%s", strings.Join(summary(ms), "\n"))
	}
}

// Notifications the recordings lack, written as codex app-server's
// protocol schema (generate-json-schema, 0.169.0) describes them.
func TestPlansFileChangesReasoningAndErrors(t *testing.T) {
	n := func(method, params string) string {
		return fmt.Sprintf(`{"method":%q,"params":%s}`, method, params)
	}
	const th = `"threadId":"T","turnId":"U"`
	ms, st := run(t, replayOf(
		n("item/reasoning/summaryTextDelta", `{`+th+`,"itemId":"rs1","summaryIndex":0,"delta":"先看"}`),
		n("item/reasoning/summaryTextDelta", `{`+th+`,"itemId":"rs1","summaryIndex":0,"delta":"文件"}`),
		n("item/agentMessage/delta", `{`+th+`,"itemId":"m1","delta":"好的"}`),
		n("item/completed", `{`+th+`,"item":{"type":"agentMessage","id":"m1","text":"好的。"}}`),
		n("turn/plan/updated", `{`+th+`,"plan":[{"step":"改代码","status":"inProgress"},{"step":"跑测试","status":"pending"}]}`),
		n("item/started", `{`+th+`,"item":{"type":"fileChange","id":"f1","status":"inProgress","changes":[{"path":"a.go","kind":{"type":"update","move_path":null},"diff":"@@ -1 +1 @@\n-a\n+b"}]}}`),
		n("item/completed", `{`+th+`,"item":{"type":"fileChange","id":"f1","status":"completed","changes":[{"path":"a.go","kind":{"type":"update","move_path":null},"diff":"@@ -1 +1 @@\n-a\n+b"}]}}`),
		n("item/started", `{`+th+`,"item":{"type":"mcpToolCall","id":"x1","server":"aibo","tool":"read_reference","status":"inProgress","arguments":{"ref_id":"ref_1"}}}`),
		n("item/completed", `{`+th+`,"item":{"type":"mcpToolCall","id":"x1","server":"aibo","tool":"read_reference","status":"completed","arguments":{"ref_id":"ref_1"},"result":{"content":[{"type":"text","text":"引用内容"}]}}}`),
		n("item/started", `{`+th+`,"item":{"type":"commandExecution","id":"c1","command":"rm -rf /","cwd":"/","status":"inProgress"}}`),
		n("item/completed", `{`+th+`,"item":{"type":"commandExecution","id":"c1","command":"rm -rf /","cwd":"/","status":"declined","aggregatedOutput":null}}`),
		n("turn/plan/updated", `{`+th+`,"plan":[{"step":"改代码","status":"completed"},{"step":"跑测试","status":"completed"}]}`),
		n("item/reasoning/textDelta", `{`+th+`,"itemId":"rs2","contentIndex":0,"delta":"最后想想"}`),
		n("error", `{`+th+`,"error":{"message":"retrying"},"willRetry":true}`),
		n("turn/completed", `{"threadId":"T","turn":{"id":"U","status":"failed","error":{"message":"usage limit reached"}}}`),
	))
	expect(t, summary(ms),
		`user done "turn"`,
		`reply done "好的。" thinking="先看文件"`,
		`plan done "- [x] 改代码\n- [x] 跑测试"`,
		`tool done apply_patch → "@@ -1 +1 @@\n-a\n+b\n" error=false`,
		`tool done aibo.read_reference → "引用内容" error=false`,
		`tool done shell → "（命令被拒绝执行）" error=true`,
		`reply done "" thinking="最后想想"`,
	)
	if st.Error != "Codex 出错：usage limit reached" {
		t.Errorf("error = %q", st.Error)
	}
}

func (s *replaySession) RespondApproval(context.Context, string, string, string) error { return nil }

func (s *replaySession) SetMode(context.Context, string) error { return nil }

func (s *replaySession) Compact(context.Context) error { return nil }

func (s *replaySession) SetModel(context.Context, string, string) error { return nil }
