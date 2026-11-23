package workbench_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/store"
	"github.com/chldu2000/aibo/internal/workbench"
)

// script answers each turn with the next of its steps, which tests feed
// one at a time so that they can look at the workbench between them.
type script struct {
	steps chan func(ctx context.Context, emit func(agent.Event))

	mu    sync.Mutex
	turns []agent.Turn
	opts  agent.StartOptions
}

// received returns what the Agent got in its turns so far, and the
// options of its native session.
func (s *script) received() ([]agent.Turn, agent.StartOptions) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]agent.Turn(nil), s.turns...), s.opts
}

func newScript() *script {
	return &script{steps: make(chan func(context.Context, func(agent.Event)))}
}

// respond runs steps until one is nil, which ends the turn.
func (s *script) respond(ctx context.Context, opts agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
	s.mu.Lock()
	s.turns, s.opts = append(s.turns, turn), opts
	s.mu.Unlock()
	for {
		select {
		case <-ctx.Done():
			return
		case step := <-s.steps:
			if step == nil {
				return
			}
			step(ctx, emit)
		}
	}
}

func (s *script) emit(evs ...agent.Event) {
	s.steps <- func(_ context.Context, emit func(agent.Event)) {
		for _, e := range evs {
			emit(e)
		}
	}
}

func (s *script) endTurn() { s.steps <- nil }

// bench is an open workbench with a fake Agent, and the changes it reports.
type bench struct {
	*workbench.Workbench
	dir     string
	fake    *fake.Agent
	changes chan workbench.Change
}

func open(t *testing.T, dir string, respond fake.Responder, now ...func() time.Time) *bench {
	t.Helper()
	o := workbench.Options{}
	if len(now) > 0 {
		o.Now = now[0]
	}
	return openWith(t, dir, respond, o)
}

func openWith(t *testing.T, dir string, respond fake.Responder, o workbench.Options) *bench {
	t.Helper()
	f := fake.New(respond)
	o.DataDir, o.Agents = dir, []agent.Agent{f}
	w, err := workbench.Open(o)
	if err != nil {
		t.Fatal(err)
	}
	b := &bench{Workbench: w, dir: dir, fake: f, changes: make(chan workbench.Change, 1024)}
	w.Subscribe(func(c workbench.Change) { b.changes <- c })
	return b
}

// waitFor waits until cond holds after a change. The guard only turns a
// hang into a failure.
func (b *bench) waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	guard := time.After(time.Minute)
	for !cond() {
		select {
		case <-b.changes:
		case <-guard:
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func (b *bench) messages(t *testing.T, id string) []model.Message {
	t.Helper()
	ms, err := b.Messages(id)
	if err != nil {
		t.Fatal(err)
	}
	return ms
}

func (b *bench) idle(t *testing.T, id string) {
	t.Helper()
	b.waitFor(t, "the turn to end", func() bool { return !b.Status(id).Running })
}

func newSession(t *testing.T, b *bench) (model.Workspace, model.Session) {
	t.Helper()
	ws, err := b.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := b.NewSession(ws.ID, fake.Kind, "fake-model")
	if err != nil {
		t.Fatal(err)
	}
	return ws, s
}

type want struct {
	seq   int
	kind  model.MessageKind
	state model.MessageState
	text  string
}

func check(t *testing.T, got []model.Message, wants ...want) {
	t.Helper()
	if len(got) != len(wants) {
		t.Fatalf("got %d messages, want %d: %+v", len(got), len(wants), got)
	}
	for i, w := range wants {
		g := got[i]
		if g.Seq != w.seq || g.Kind != w.kind || g.State != w.state || g.Text != w.text {
			t.Errorf("message %d = {#%d %s %s %q}, want {#%d %s %s %q}", i, g.Seq, g.Kind, g.State, g.Text, w.seq, w.kind, w.state, w.text)
		}
	}
}

func TestReplyStreamsThenEnds(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)

	if err := b.Send(s.ID, "  你好  "); err != nil {
		t.Fatal(err)
	}
	if !b.Status(s.ID).Running {
		t.Fatal("not running after Send")
	}
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "**你"})
	b.waitFor(t, "the first delta", func() bool { return len(b.messages(t, s.ID)) == 2 })
	check(t, b.messages(t, s.ID),
		want{1, model.UserMessage, model.Done, "你好"},
		want{2, model.AgentReply, model.Streaming, "**你"})

	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "好**"}, agent.ReplyDone{ReplyID: "r"})
	sc.endTurn()
	b.idle(t, s.ID)
	check(t, b.messages(t, s.ID),
		want{1, model.UserMessage, model.Done, "你好"},
		want{2, model.AgentReply, model.Done, "**你好**"})
	if st := b.Status(s.ID); !st.Connected || st.Error != nil {
		t.Errorf("status = %+v, want connected without error", st)
	}
}

func TestChangesCarryStreamingMessages(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	carried := make(chan model.Message, 100)
	b.Subscribe(func(c workbench.Change) {
		if c.SessionID == s.ID && c.Message != nil {
			carried <- *c.Message
		}
	})
	b.Send(s.ID, "hi")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "a"}, agent.ReplyDelta{ReplyID: "r", Text: "b"})
	guard := time.After(time.Minute)
	for {
		select {
		case m := <-carried:
			if m.Text != "ab" {
				continue
			}
			if m.Seq != 2 || m.State != model.Streaming {
				t.Errorf("change = %+v", m)
			}
		case <-guard:
			t.Fatal(`no change carried "ab"`)
		}
		break
	}
	sc.endTurn()
	b.idle(t, s.ID)
}

func TestSeqGrowsAcrossTurnsAndReplies(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)

	b.Send(s.ID, "one")
	sc.emit(agent.ReplyDelta{ReplyID: "a", Text: "first"}, agent.ReplyDone{ReplyID: "a"},
		agent.ReplyDelta{ReplyID: "b", Text: "second"}, agent.ReplyDone{ReplyID: "b", Text: "second, in full"})
	sc.endTurn()
	b.idle(t, s.ID)
	b.Send(s.ID, "two")
	sc.emit(agent.ReplyDelta{ReplyID: "a", Text: "third"})
	sc.endTurn()
	b.idle(t, s.ID)

	check(t, b.messages(t, s.ID),
		want{1, model.UserMessage, model.Done, "one"},
		want{2, model.AgentReply, model.Done, "first"},
		want{3, model.AgentReply, model.Done, "second, in full"},
		want{4, model.UserMessage, model.Done, "two"},
		// A reply the turn ended without finishing is done with it.
		want{5, model.AgentReply, model.Done, "third"})
}

func TestStopInterruptsTheReply(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)

	b.Send(s.ID, "write a novel")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "Once upon"})
	b.waitFor(t, "the delta", func() bool { return len(b.messages(t, s.ID)) == 2 })
	if err := b.Stop(s.ID); err != nil {
		t.Fatal(err)
	}
	b.idle(t, s.ID)
	check(t, b.messages(t, s.ID),
		want{1, model.UserMessage, model.Done, "write a novel"},
		want{2, model.AgentReply, model.Interrupted, "Once upon"})

	// The session takes the next turn.
	b.Send(s.ID, "shorter")
	sc.endTurn()
	b.idle(t, s.ID)
	if n := len(b.messages(t, s.ID)); n != 3 {
		t.Errorf("%d messages, want 3", n)
	}
}

func TestOneTurnAtATime(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	b.Send(s.ID, "one")
	if err := b.Send(s.ID, "two"); !errors.Is(err, workbench.ErrTurnRunning) {
		t.Errorf("second Send: %v, want ErrTurnRunning", err)
	}
	if err := b.Send(s.ID, "   "); !errors.Is(err, workbench.ErrEmptyMessage) {
		t.Errorf("blank Send: %v, want ErrEmptyMessage", err)
	}
	sc.endTurn()
	b.idle(t, s.ID)
}

func TestHistorySurvivesRestartAndResumes(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	ws, s := newSession(t, b)
	b.Send(s.ID, "remember this\nsecond line")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "noted"}, agent.ReplyDone{ReplyID: "r"})
	sc.endTurn()
	b.idle(t, s.ID)
	native := b.fake.Starts()
	if len(native) != 1 || native[0].ResumeID != "" || native[0].Workspace != ws.Path || native[0].Model != "fake-model" {
		t.Fatalf("starts = %+v", native)
	}
	first, _ := b.Session(s.ID)
	if first.NativeID() == "" {
		t.Fatal("no native session recorded")
	}
	b.Close()

	sc2 := newScript()
	b2 := open(t, dir, sc2.respond)
	defer b2.Close()
	if got := b2.Workspaces(); len(got) != 1 || got[0].Path != ws.Path {
		t.Fatalf("workspaces after restart = %+v", got)
	}
	got, ok := b2.Session(s.ID)
	if !ok || got.Title != "remember this" || got.NativeID() != first.NativeID() {
		t.Fatalf("session after restart = %+v", got)
	}
	if b2.Status(s.ID).Connected {
		t.Error("restart connected the session before any message")
	}
	check(t, b2.messages(t, s.ID),
		want{1, model.UserMessage, model.Done, "remember this\nsecond line"},
		want{2, model.AgentReply, model.Done, "noted"})

	// The first message after the restart resumes the native session.
	b2.Send(s.ID, "what did I say?")
	sc2.endTurn()
	b2.idle(t, s.ID)
	starts := b2.fake.Starts()
	if len(starts) != 1 || starts[0].ResumeID != first.NativeID() {
		t.Errorf("starts after restart = %+v, want a resume of %s", starts, first.NativeID())
	}
	if n := b2.messages(t, s.ID)[2].Seq; n != 3 {
		t.Errorf("first seq after restart = %d, want 3", n)
	}
}

func TestCloseInterruptsRunningTurn(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b)
	b.Send(s.ID, "go")
	sc.emit(agent.ReplyDelta{ReplyID: "r", Text: "partial"})
	b.waitFor(t, "the delta", func() bool { return len(b.messages(t, s.ID)) == 2 })
	b.Close()

	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	check(t, b2.messages(t, s.ID),
		want{1, model.UserMessage, model.Done, "go"},
		want{2, model.AgentReply, model.Interrupted, "partial"})
}

func TestOpenInterruptsWhatACrashLeftStreaming(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	st.AddWorkspace(model.Workspace{ID: "w1", Path: "/tmp/x", CreatedAt: now})
	st.CreateSession(model.Session{ID: "s1", WorkspaceID: "w1", Agent: fake.Kind, CreatedAt: now, ActiveAt: now})
	st.AppendMessage("s1", model.Message{Kind: model.AgentReply, State: model.Streaming, Text: "cut", CreatedAt: now})
	st.Close()

	b := open(t, dir, newScript().respond)
	defer b.Close()
	check(t, b.messages(t, "s1"), want{1, model.AgentReply, model.Interrupted, "cut"})
}

func TestDefaultTitle(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	long := strings.Repeat("长", 50) + "\n下一行"
	b.Send(s.ID, long)
	sc.endTurn()
	b.idle(t, s.ID)
	got, _ := b.Session(s.ID)
	if want := strings.Repeat("长", 40) + "…"; got.Title != want {
		t.Errorf("title = %q, want %q", got.Title, want)
	}
	// Later messages keep the title.
	b.Send(s.ID, "another")
	sc.endTurn()
	b.idle(t, s.ID)
	if again, _ := b.Session(s.ID); again.Title != got.Title {
		t.Errorf("title changed to %q", again.Title)
	}
}

func TestAddWorkspace(t *testing.T) {
	b := open(t, t.TempDir(), newScript().respond)
	defer b.Close()
	dir := t.TempDir()
	ws, err := b.AddWorkspace(filepath.Join(dir, "."))
	if err != nil {
		t.Fatal(err)
	}
	if ws.Path != dir {
		t.Errorf("path = %q, want %q", ws.Path, dir)
	}
	if _, err := b.AddWorkspace(dir); !errors.Is(err, workbench.ErrWorkspaceExists) {
		t.Errorf("adding twice: %v", err)
	}
	file := filepath.Join(dir, "f.txt")
	os.WriteFile(file, nil, 0o644)
	if _, err := b.AddWorkspace(file); !errors.Is(err, workbench.ErrNotDirectory) {
		t.Errorf("adding a file: %v", err)
	}
	if _, err := b.NewSession("nope", fake.Kind, ""); !errors.Is(err, workbench.ErrNoSuchWorkspace) {
		t.Errorf("session in unknown workspace: %v", err)
	}
	if _, err := b.NewSession(ws.ID, "nobody", ""); !errors.Is(err, workbench.ErrUnknownAgent) {
		t.Errorf("session with unknown agent: %v", err)
	}
}

func TestSessionsSortByActivity(t *testing.T) {
	sc := newScript()
	var mu sync.Mutex
	clock := time.Date(2026, 11, 20, 9, 0, 0, 0, time.UTC)
	tick := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		clock = clock.Add(time.Second)
		return clock
	}
	b := open(t, t.TempDir(), sc.respond, tick)
	defer b.Close()
	ws, older := newSession(t, b)
	newer, _ := b.NewSession(ws.ID, fake.Kind, "")
	if got := b.Sessions(); got[0].ID != newer.ID {
		t.Fatalf("newest first: got %s first", got[0].ID)
	}
	b.Send(older.ID, "bump")
	sc.endTurn()
	b.idle(t, older.ID)
	if got := b.Sessions(); got[0].ID != older.ID {
		t.Errorf("most recently active first: got %s first", got[0].ID)
	}
}

func TestAgentFailureIsReported(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	b.Send(s.ID, "hi")
	sc.emit(agent.Failed{Message: "boom"})
	sc.endTurn()
	b.idle(t, s.ID)
	if st := b.Status(s.ID); fmt.Sprint(st.Error) != "agent: boom" {
		t.Errorf("error = %q", st.Error)
	}
	b.Send(s.ID, "again")
	if st := b.Status(s.ID); st.Error != nil {
		t.Errorf("error kept into the next turn: %q", st.Error)
	}
	sc.endTurn()
	b.idle(t, s.ID)
}
