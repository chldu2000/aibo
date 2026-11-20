package workbench_test

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

var options = []agent.ApprovalOption{
	{ID: "once", Kind: agent.AllowOnce, Label: "批准本次"},
	{ID: "session", Kind: agent.AllowSession, Label: "本会话内始终允许"},
	{ID: "always", Kind: agent.AllowAlways, Label: "永久允许", Where: ".claude/settings.local.json"},
	{ID: "no", Kind: agent.Deny, Label: "拒绝"},
	{ID: "stop", Kind: agent.DenyStop, Label: "拒绝并停止"},
}

// gated opens a session whose Agent asks to write each path given, one
// tool call each, waits for the answer and reports it as the result.
func gated(t *testing.T, dir string, early bool, paths ...string) (*bench, model.Workspace, model.Session) {
	t.Helper()
	var f *fake.Agent
	respond := func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		for i, p := range paths {
			id := string(rune('a' + i))
			req := agent.ApprovalRequested{ID: "ap-" + id, ToolID: id, Title: "修改文件", Paths: []string{p}, Diff: "+hi", Options: options}
			start := agent.ToolStarted{ToolID: id, Name: "Write", Input: json.RawMessage(`{}`)}
			if early { // the request comes before its call
				emit(req)
				emit(start)
			} else {
				emit(start)
				emit(req)
			}
			select {
			case d := <-f.Decisions():
				emit(agent.ToolFinished{ToolID: id, Output: d.OptionID + ":" + d.Note})
			case <-ctx.Done():
				return
			}
		}
	}
	f = fake.New(respond)
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{f}})
	if err != nil {
		t.Fatal(err)
	}
	b := &bench{Workbench: w, dir: dir, fake: f, changes: make(chan workbench.Change, 1024)}
	w.Subscribe(func(c workbench.Change) { b.changes <- c })
	ws, _ := w.AddWorkspace(dir)
	s, _ := w.NewSession(ws.ID, fake.Kind, "")
	return b, ws, s
}

func pendingOn(b *bench, t *testing.T, id string) *model.Approval {
	for _, m := range b.messages(t, id) {
		if m.Tool != nil && m.Tool.Approval.Pending() {
			return m.Tool.Approval
		}
	}
	return nil
}

func TestApprovalWaitsAndRecordsTheAnswer(t *testing.T) {
	dir := t.TempDir()
	b, _, s := gated(t, dir, false, "notes.txt", filepath.Join(dir, "x.txt"), "/etc/hosts")
	b.Send(s.ID, "写")
	b.waitFor(t, "the first request", func() bool { return pendingOn(b, t, s.ID) != nil })
	a := pendingOn(b, t, s.ID)
	if a.Outside || len(a.Options) != 5 || a.Title != "修改文件" || a.Diff != "+hi" {
		t.Errorf("request = %+v", a)
	}
	if st := b.Status(s.ID); st.Approvals != 1 || !st.Running {
		t.Errorf("status = %+v", st)
	}
	if err := b.Approve(s.ID, a.ID, "nope", ""); !errors.Is(err, workbench.ErrNoSuchApproval) {
		t.Errorf("an option it does not have: %v", err)
	}
	if err := b.Approve(s.ID, a.ID, "once", ""); err != nil {
		t.Fatal(err)
	}
	if err := b.Approve(s.ID, a.ID, "once", ""); !errors.Is(err, workbench.ErrNoSuchApproval) {
		t.Errorf("answering twice: %v", err)
	}

	b.waitFor(t, "the second request", func() bool { p := pendingOn(b, t, s.ID); return p != nil && p.ID == "ap-b" })
	if a := pendingOn(b, t, s.ID); a.Outside {
		t.Errorf("a path inside the workspace is outside: %+v", a.Paths)
	}
	b.Approve(s.ID, "ap-b", "session", "")
	b.waitFor(t, "the third request", func() bool { p := pendingOn(b, t, s.ID); return p != nil && p.ID == "ap-c" })
	if a := pendingOn(b, t, s.ID); !a.Outside {
		t.Errorf("/etc/hosts is not outside the workspace")
	}
	b.Approve(s.ID, "ap-c", "no", "  不要改系统文件 ")
	b.idle(t, s.ID)

	check := func(ms []model.Message) {
		t.Helper()
		var answers []string
		for _, m := range ms {
			if m.Tool != nil {
				answers = append(answers, m.Tool.Approval.Answer.Label+"|"+m.Tool.Approval.Note+"|"+m.Tool.Output)
			}
		}
		want := []string{"批准本次||once:", "本会话内始终允许||session:", "拒绝|不要改系统文件|no:不要改系统文件"}
		if len(answers) != 3 || answers[0] != want[0] || answers[1] != want[1] || answers[2] != want[2] {
			t.Errorf("answers = %q", answers)
		}
	}
	check(b.messages(t, s.ID))
	b.Close()
	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	check(b2.messages(t, s.ID))
}

func TestApprovalBeforeItsCall(t *testing.T) {
	b, _, s := gated(t, t.TempDir(), true, "a.txt")
	defer b.Close()
	b.Send(s.ID, "写")
	b.waitFor(t, "the request on its call", func() bool { return pendingOn(b, t, s.ID) != nil })
	if l := b.LooseApprovals(s.ID); len(l) != 0 {
		t.Errorf("still loose: %+v", l)
	}
	b.Approve(s.ID, "ap-a", "once", "")
	b.idle(t, s.ID)
}

func TestUnansweredApprovalExpiresWithTheTurn(t *testing.T) {
	b, _, s := gated(t, t.TempDir(), false, "a.txt")
	defer b.Close()
	b.Send(s.ID, "写")
	b.waitFor(t, "the request", func() bool { return pendingOn(b, t, s.ID) != nil })
	b.Stop(s.ID)
	b.idle(t, s.ID)
	m := b.messages(t, s.ID)[1]
	if m.Tool.Approval.Pending() || !m.Tool.Approval.Expired || m.State != model.Interrupted {
		t.Errorf("after stop: %+v %+v", m, m.Tool.Approval)
	}
	if st := b.Status(s.ID); st.Approvals != 0 {
		t.Errorf("status = %+v", st)
	}
}
