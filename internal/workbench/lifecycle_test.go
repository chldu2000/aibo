package workbench_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestResumeFailureAndRecovery(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b)
	converse(t, b, sc, s.ID, "第一轮", "回复一")
	converse(t, b, sc, s.ID, "第二轮", "回复二")
	first, _ := b.Session(s.ID)
	b.Close()

	sc2 := newScript()
	b2 := open(t, dir, sc2.respond)
	b2.fake.FailResumes("No conversation found with session ID: " + first.NativeID())
	err := b2.Send(s.ID, "继续")
	if !errors.Is(err, agent.ErrResumeFailed) {
		t.Fatalf("send: %v", err)
	}
	st := b2.Status(s.ID)
	if !strings.Contains(st.ResumeFailed, "No conversation found") || st.Running || st.ReadOnly {
		t.Errorf("status = %+v", st)
	}
	if n := len(b2.messages(t, s.ID)); n != 4 {
		t.Errorf("%d messages: the undelivered one was recorded", n)
	}
	if err := b2.Send(s.ID, "再试"); !errors.Is(err, workbench.ErrNeedsRecovery) {
		t.Errorf("sending before choosing: %v", err)
	}
	if err := b2.Compact(s.ID); !errors.Is(err, workbench.ErrNeedsRecovery) {
		t.Errorf("compacting before choosing: %v", err)
	}

	b2.Recover(s.ID, workbench.Later)
	if st := b2.Status(s.ID); !st.ReadOnly || st.ResumeFailed == "" {
		t.Errorf("after later: %+v", st)
	}
	if err := b2.Send(s.ID, "还是不行"); !errors.Is(err, workbench.ErrNeedsRecovery) {
		t.Errorf("read-only send: %v", err)
	}

	if err := b2.Recover(s.ID, workbench.FreshWithReference); err != nil {
		t.Fatal(err)
	}
	if st := b2.Status(s.ID); st.ResumeFailed != "" || st.ReadOnly {
		t.Errorf("after recovering: %+v", st)
	}
	ms := b2.Markers(s.ID)
	if len(ms) != 1 || ms[0].Kind != model.Reset || ms[0].AfterSeq != 4 {
		t.Errorf("markers = %+v", ms)
	}
	d := b2.Drafts(s.ID)
	if len(d) != 1 || d[0].SourceID != s.ID || d[0].From != 1 || d[0].To != 4 || !strings.Contains(d[0].Brief, "这是本会话较早的一段内容") {
		t.Fatalf("drafts = %+v", d)
	}
	b2.Close()

	// The choice holds across a restart: the next start is a new one.
	sc3 := newScript()
	b3 := open(t, dir, sc3.respond)
	defer b3.Close()
	b3.fake.FailResumes("still lost")
	converse(t, b3, sc3, s.ID, "接着来")
	if st := b3.fake.Starts(); len(st) != 1 || st[0].ResumeID != "" {
		t.Errorf("starts = %+v", st)
	}
	turn, _ := lastTurn(sc3)
	if !strings.HasPrefix(turn.Text, "<aibo-reference") || !strings.HasSuffix(turn.Text, "接着来") {
		t.Errorf("the Agent got %q", turn.Text)
	}
	got, _ := b3.Session(s.ID)
	if ids := got.NativeIDs; len(ids) != 3 || ids[0] != first.NativeID() || ids[1] != "" || ids[2] == "" {
		t.Errorf("native sessions = %q", ids)
	}
}

func TestRecoverFreshWithoutReference(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b)
	converse(t, b, sc, s.ID, "一", "回复")
	b.Close()
	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	b2.fake.FailResumes("lost")
	b2.Send(s.ID, "二")
	b2.Recover(s.ID, workbench.Fresh)
	if d := b2.Drafts(s.ID); len(d) != 0 {
		t.Errorf("drafts = %+v", d)
	}
	if ms := b2.Markers(s.ID); len(ms) != 1 || ms[0].Kind != model.Reset {
		t.Errorf("markers = %+v", ms)
	}
}

func TestIdleSessionsDisconnect(t *testing.T) {
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Text != "ask" {
			return
		}
		emit(agent.ToolStarted{ToolID: "t", Name: "Bash", Input: json.RawMessage(`{}`)})
		emit(agent.ApprovalRequested{ID: "a", ToolID: "t", Title: "执行命令", Options: []agent.ApprovalOption{{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"}}})
		select {
		case <-f.Decisions():
		case <-ctx.Done():
		}
	}
	f = fake.New(respond)
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{f}, IdleTimeout: 50 * time.Millisecond, IdleCheck: 10 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	b := &bench{Workbench: w, fake: f, changes: make(chan workbench.Change, 1024)}
	w.Subscribe(func(c workbench.Change) { b.changes <- c })
	defer b.Close()
	_, s := newSession(t, b)
	b.Send(s.ID, "hi")
	b.idle(t, s.ID)
	starts := f.Starts()
	b.waitFor(t, "the idle session to disconnect", func() bool { return !b.Status(s.ID).Connected })

	// It resumes on the next message, with a new token.
	b.Send(s.ID, "ask")
	b.waitFor(t, "the request", func() bool { return b.Status(s.ID).Approvals == 1 })
	again := f.Starts()
	if len(again) != len(starts)+1 || again[len(again)-1].ResumeID == "" || again[len(again)-1].MCP.Token == starts[0].MCP.Token {
		t.Errorf("starts = %+v", again)
	}
	if _, _, err := fake.CallTool(context.Background(), starts[0].MCP, "list_references", nil); err == nil {
		t.Error("the old token still works")
	}
	// Waiting for an approval, it stays: well past the timeout.
	time.Sleep(200 * time.Millisecond)
	if !b.Status(s.ID).Connected {
		t.Error("a session waiting for an approval disconnected")
	}
	b.Approve(s.ID, "a", "once", "")
	b.idle(t, s.ID)
	b.waitFor(t, "the idle session to disconnect", func() bool { return !b.Status(s.ID).Connected })
}
