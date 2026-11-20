package workbench_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestApprovalLevel(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	_, s := newSession(t, b)
	if s.Level != agent.AskAlways {
		t.Errorf("new session's level = %q", s.Level)
	}
	if err := b.SetLevel(s.ID, "yolo"); !errors.Is(err, workbench.ErrNoSuchLevel) {
		t.Errorf("an unknown level: %v", err)
	}
	b.SetLevel(s.ID, agent.AcceptEdits)
	converse(t, b, sc, s.ID, "hi")
	if st := b.fake.Starts(); st[0].Level != agent.AcceptEdits {
		t.Errorf("started with %q", st[0].Level)
	}
	// A running session changes at once.
	if err := b.SetLevel(s.ID, agent.FullAuto); err != nil {
		t.Fatal(err)
	}
	if l := <-b.fake.Levels(); l != agent.FullAuto {
		t.Errorf("the session got %q", l)
	}
	b.Close()

	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	if got, _ := b2.Session(s.ID); got.Level != agent.FullAuto {
		t.Errorf("after restart: %q", got.Level)
	}
}

func TestSessionRules(t *testing.T) {
	dir := t.TempDir()
	rule := agent.Rule{Label: "Bash(go test ./...)", Data: json.RawMessage(`{"rule":1}`)}
	var f *fake.Agent // the Agent of the workbench open now
	asked := 0
	release := make(chan struct{})
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Text != "ask" {
			if turn.Text == "wait" {
				select {
				case <-release:
				case <-ctx.Done():
				}
			}
			return
		}
		asked++
		emit(agent.ToolStarted{ToolID: "t", Name: "Bash", Input: json.RawMessage(`{}`)})
		emit(agent.ApprovalRequested{ID: "a", ToolID: "t", Title: "执行命令", Options: []agent.ApprovalOption{
			{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"},
			{ID: "session", Kind: agent.AllowSession, Label: "本会话内始终允许（Bash(go test ./...)）", Rules: []agent.Rule{rule}},
		}})
		<-f.Decisions()
		emit(agent.ToolFinished{ToolID: "t", Output: "ok"})
	}
	f = fake.New(respond)
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	b := &bench{Workbench: w, dir: dir, fake: f, changes: make(chan workbench.Change, 1024)}
	w.Subscribe(func(c workbench.Change) { b.changes <- c })
	_, s := newSession(t, b)

	b.Send(s.ID, "ask")
	b.waitFor(t, "the request", func() bool { return pendingOn(b, t, s.ID) != nil })
	b.Approve(s.ID, "a", "session", "")
	b.idle(t, s.ID)
	got, _ := b.Session(s.ID)
	if len(got.Rules) != 1 || got.Rules[0].Label != rule.Label {
		t.Fatalf("rules = %+v", got.Rules)
	}
	b.Close()

	// The rules come back with the session.
	f2 := fake.New(respond)
	f = f2
	w2, _ := workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{f2}})
	b2 := &bench{Workbench: w2, dir: dir, fake: f2, changes: make(chan workbench.Change, 1024)}
	w2.Subscribe(func(c workbench.Change) { b2.changes <- c })
	defer b2.Close()
	b2.Send(s.ID, "hi")
	b2.idle(t, s.ID)
	if st := f2.Starts(); len(st) != 1 || len(st[0].Rules) != 1 || string(st[0].Rules[0].Data) != `{"rule":1}` {
		t.Fatalf("started with %+v", st)
	}

	// Revoked while idle: the native session stops, and starts again
	// without the rule.
	if err := b2.RevokeRule(s.ID, 0); err != nil {
		t.Fatal(err)
	}
	b2.waitFor(t, "the native session to stop", func() bool { return !b2.Status(s.ID).Connected })
	if got, _ := b2.Session(s.ID); len(got.Rules) != 0 {
		t.Errorf("rules after revoking = %+v", got.Rules)
	}
	b2.Send(s.ID, "hi")
	b2.idle(t, s.ID)
	if st := f2.Starts(); len(st) != 2 || len(st[1].Rules) != 0 {
		t.Errorf("restarted with %+v", st)
	}
	if err := b2.RevokeRule(s.ID, 0); !errors.Is(err, workbench.ErrNoSuchRule) {
		t.Errorf("revoking twice: %v", err)
	}

	// Revoked during a turn: it restarts once the turn ends.
	b2.Send(s.ID, "ask")
	b2.waitFor(t, "the request", func() bool { return pendingOn(b2, t, s.ID) != nil })
	b2.Approve(s.ID, "a", "session", "")
	b2.idle(t, s.ID)
	if err := b2.Send(s.ID, "wait"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if err := b2.RevokeRule(s.ID, 0); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if st := b2.Status(s.ID); !st.Connected {
		t.Errorf("revoking stopped a running turn: %+v", st)
	}
	close(release)
	b2.waitFor(t, "the restart after the turn", func() bool { return !b2.Status(s.ID).Connected })
}
