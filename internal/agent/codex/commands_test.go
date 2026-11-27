package codex

import (
	"bytes"
	"encoding/json"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// scripted is an app-server that answers each call with answer, and
// keeps the calls.
type scripted struct {
	srv    *server
	answer func(method string, params json.RawMessage) any

	mu    sync.Mutex
	calls []rpc
}

type rpc struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     *int            `json:"id"`
}

func newScripted(answer func(string, json.RawMessage) any) *scripted {
	sc := &scripted{answer: answer}
	sc.srv = &server{log: agent.Discard, sessions: map[string]*session{}, pending: map[int]chan response{}, stdin: writer(sc.write),
		onIdle: func(*server) {}, exited: make(chan struct{})}
	return sc
}

type writer func([]byte) (int, error)

func (w writer) Write(b []byte) (int, error) { return w(b) }
func (w writer) Close() error                { return nil }

func (sc *scripted) write(b []byte) (int, error) {
	var c rpc
	json.Unmarshal(bytes.TrimSpace(b), &c)
	sc.mu.Lock()
	sc.calls = append(sc.calls, c)
	sc.mu.Unlock()
	if c.ID != nil && c.Method != "" {
		res, _ := json.Marshal(sc.answer(c.Method, c.Params))
		go func() {
			sc.srv.mu.Lock()
			ch := sc.srv.pending[*c.ID]
			delete(sc.srv.pending, *c.ID)
			sc.srv.mu.Unlock()
			if ch != nil {
				ch <- response{result: res}
			}
		}()
	}
	return len(b), nil
}

func (sc *scripted) called(method string) []json.RawMessage {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	var out []json.RawMessage
	for _, c := range sc.calls {
		if c.Method == method {
			out = append(out, c.Params)
		}
	}
	return out
}

// skillsResult is codex-cli 0.169.0's answer to skills/list, as recorded
// in .scratch/agent-commands/research/01-probes/codex_skills.jsonl.
func skillsResult(t *testing.T) json.RawMessage {
	t.Helper()
	b, err := os.ReadFile("testdata/skills-0.169.0.json")
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m.Result
}

func newTestSession(sc *scripted) *session {
	s := &session{srv: sc.srv, id: "T1", events: make(chan agent.Event, 64), parse: newThread(), cwd: "/w",
		start:   map[string]any{"cwd": "/w", "sandbox": "read-only", "approvalPolicy": "on-request"},
		current: settings{}}
	sc.srv.attach(s)
	return s
}

func next(t *testing.T, s *session) agent.Event {
	t.Helper()
	select {
	case e := <-s.events:
		return e
	case <-time.After(10 * time.Second):
		t.Fatal("no event")
		return nil
	}
}

// The commands are the built-ins carried out, then the skills, with
// where they come from and their files.
func TestSkillCommands(t *testing.T) {
	cmds := commands(skillsResult(t))
	var names []string
	for _, c := range cmds[:len(builtins)] {
		names = append(names, c.Name)
	}
	if !slices.Equal(names, []string{"model", "permissions", "compact", "review", "rename", "new", "clear"}) {
		t.Errorf("built-ins = %v", names)
	}
	i := slices.IndexFunc(cmds, func(c agent.Command) bool { return c.Name == "probe-greet" })
	if i < 0 {
		t.Fatal("no probe-greet")
	}
	c := cmds[i]
	if c.Source != "repo" || c.Builtin || c.Handling != agent.ByAgent || c.Description == "" {
		t.Errorf("probe-greet = %+v", c)
	}
	if in, ok := skillInput(&c); !ok || in["path"] != "/private/tmp/aibo-cmdprobe/ws/.agents/skills/probe-greet/SKILL.md" {
		t.Errorf("its item = %v", in)
	}
	for _, c := range cmds[len(builtins):] {
		if c.Source == "" || c.Builtin {
			t.Errorf("skill %+v", c)
		}
	}

	// Disabled ones, and one named as a built-in, are not offered.
	got := commands(json.RawMessage(`{"data":[{"cwd":"/w","skills":[
		{"name":"off","description":"d","path":"/p/off/SKILL.md","scope":"user","enabled":false},
		{"name":"model","description":"d","path":"/p/model/SKILL.md","scope":"user","enabled":true},
		{"name":"short","description":"","interface":{"shortDescription":"from the interface"},"path":"/p/s/SKILL.md","scope":"system","enabled":true}]}]}`))
	if len(got) != len(builtins)+1 || got[len(builtins)].Name != "short" || got[len(builtins)].Description != "from the interface" {
		t.Errorf("commands = %+v", got[len(builtins):])
	}
}

// A skill goes as "$name" and its item; what follows it, after it.
func TestSendSkill(t *testing.T) {
	sc := newScripted(func(string, json.RawMessage) any { return map[string]any{"turn": map[string]any{"id": "turn-1"}} })
	s := newTestSession(sc)
	data, _ := json.Marshal(skillData{Path: "/w/.agents/skills/greet/SKILL.md"})
	if err := s.Send(t.Context(), agent.Turn{Command: &agent.Command{Name: "greet", Data: data}, Text: "Bob"}); err != nil {
		t.Fatal(err)
	}
	var p struct {
		Input []map[string]any `json:"input"`
	}
	json.Unmarshal(sc.called("turn/start")[0], &p)
	want := []map[string]any{{"type": "text", "text": "$greet Bob"}, {"type": "skill", "name": "greet", "path": "/w/.agents/skills/greet/SKILL.md"}}
	if len(p.Input) != 2 || p.Input[0]["text"] != want[0]["text"] || p.Input[1]["type"] != "skill" || p.Input[1]["name"] != "greet" || p.Input[1]["path"] != want[1]["path"] {
		t.Errorf("input = %v", p.Input)
	}
}

// "/clear" starts a new thread in the session's settings, which it goes
// on in, as a turn of its own; the old thread is let go.
func TestReset(t *testing.T) {
	sc := newScripted(func(method string, _ json.RawMessage) any {
		if method == "thread/start" {
			return map[string]any{"thread": map[string]any{"id": "T2"}}
		}
		return map[string]any{}
	})
	s := newTestSession(sc)
	s.SetMode(t.Context(), "full-access")
	s.SetModel(t.Context(), "gpt-x", "high")
	if err := s.Send(t.Context(), agent.Turn{Command: &agent.Command{Name: "clear", Handling: agent.ByReset}}); err != nil {
		t.Fatal(err)
	}
	if _, ok := next(t, s).(agent.ContextReset); !ok {
		t.Fatal("no ContextReset first")
	}
	if e, ok := next(t, s).(agent.NativeSessionStarted); !ok || e.ID != "T2" {
		t.Fatalf("then %+v", e)
	}
	for {
		if _, ok := next(t, s).(agent.TurnEnded); ok {
			break
		}
	}
	var p map[string]any
	json.Unmarshal(sc.called("thread/start")[0], &p)
	full, _ := presetOf("full-access")
	if p["cwd"] != "/w" || p["model"] != "gpt-x" || p["sandbox"] != full.sandbox || p["approvalPolicy"] != full.policy || p["threadId"] != nil {
		t.Errorf("thread/start = %v", p)
	}
	if len(sc.called("turn/start")) != 0 {
		t.Error("a turn went to the model")
	}
	sc.srv.mu.Lock()
	_, onNew := sc.srv.sessions["T2"]
	_, onOld := sc.srv.sessions["T1"]
	sc.srv.mu.Unlock()
	if !onNew || onOld {
		t.Errorf("sessions = %v", sc.srv.sessions)
	}
	time.Sleep(50 * time.Millisecond)
	if u := sc.called("thread/unsubscribe"); len(u) != 1 || !bytes.Contains(u[0], []byte(`"T1"`)) {
		t.Errorf("unsubscribed %s", u)
	}

	// The next turn is the new thread's, with the effort again.
	if err := s.Send(t.Context(), agent.Turn{Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(sc.called("turn/start")[0], &p)
	if p["threadId"] != "T2" || p["effort"] != "high" {
		t.Errorf("turn/start = %v", p)
	}
}

// skills/changed has each thread list its skills again, and tell them.
func TestSkillsChanged(t *testing.T) {
	result := skillsResult(t)
	sc := newScripted(func(method string, _ json.RawMessage) any {
		if method == "skills/list" {
			return result
		}
		return map[string]any{}
	})
	s := newTestSession(sc)
	sc.srv.notify("skills/changed", json.RawMessage(`{}`))
	e, ok := next(t, s).(agent.CommandsChanged)
	if !ok || len(e.Commands) <= len(builtins) {
		t.Fatalf("event = %+v", e)
	}
	if p := sc.called("skills/list"); len(p) != 1 || !bytes.Contains(p[0], []byte(`"cwds":["/w"]`)) {
		t.Errorf("skills/list = %s", p)
	}
}

// A review is a turn: its commands, and its findings as the reply, once
// (codex-cli 0.172.0, on an uncommitted change).
func TestReviewEvents(t *testing.T) {
	b, err := os.ReadFile("testdata/review-0.172.0.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	th := newThread()
	var replies []string
	tools, ends := 0, 0
	for _, l := range bytes.Split(bytes.TrimSpace(b), []byte("\n")) {
		var m struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		json.Unmarshal(l, &m)
		for _, e := range th.handle(m.Method, m.Params) {
			switch e := e.(type) {
			case agent.ReplyDone:
				if e.Text != "" {
					replies = append(replies, e.Text)
				}
			case agent.ToolStarted:
				tools++
			case agent.TurnEnded:
				ends++
			}
		}
	}
	if len(replies) != 1 || !bytes.Contains([]byte(replies[0]), []byte("[P1] Restore addition")) {
		t.Errorf("replies = %q", replies)
	}
	if tools != 2 || ends != 1 {
		t.Errorf("%d tools, %d ends", tools, ends)
	}
}

// "/review" goes as review/start: the uncommitted changes, or what the
// words after it ask for; what was set waits for the next turn.
func TestSendReview(t *testing.T) {
	sc := newScripted(func(string, json.RawMessage) any { return map[string]any{"turn": map[string]any{"id": "review-turn"}} })
	s := newTestSession(sc)
	s.SetModel(t.Context(), "gpt-x", "")
	review := &agent.Command{Name: "review", Builtin: true}
	if err := s.Send(t.Context(), agent.Turn{Command: review}); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	turn := s.turn
	s.running = false // as turn/completed would
	s.mu.Unlock()
	if turn != "review-turn" {
		t.Errorf("turn = %q", turn)
	}
	if err := s.Send(t.Context(), agent.Turn{Command: review, Text: "focus on errors"}); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
	got := sc.called("review/start")
	if len(got) != 2 || !bytes.Contains(got[0], []byte(`"target":{"type":"uncommittedChanges"}`)) ||
		!bytes.Contains(got[1], []byte(`"target":{"instructions":"focus on errors","type":"custom"}`)) || !bytes.Contains(got[0], []byte(`"threadId":"T1"`)) {
		t.Errorf("review/start = %s", got)
	}
	// A skill named review is not the review.
	if isReview(&agent.Command{Name: "review"}) {
		t.Error("a skill is the review")
	}
	if err := s.Send(t.Context(), agent.Turn{Text: "hi"}); err != nil {
		t.Fatal(err)
	}
	if p := sc.called("turn/start"); len(p) != 1 || !bytes.Contains(p[0], []byte(`"model":"gpt-x"`)) {
		t.Errorf("turn/start = %s", p)
	}
}
