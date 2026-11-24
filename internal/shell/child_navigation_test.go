package shell

import (
	"context"
	"encoding/json"
	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
	"sync/atomic"
	"testing"
	"time"
)

type historyAgent struct {
	*fake.Agent
	reads atomic.Int32
}

func (a *historyAgent) ReadChildPage(_ context.Context, parent, child, cursor string, limit int) (agent.ChildPage, error) {
	a.reads.Add(1)
	if parent != "fake-native-1" || child != "child" {
		return agent.ChildPage{}, agent.ErrChildHistory
	}
	entry := agent.HistoryEntry{TurnID: "1", ItemID: "1", Kind: "agentMessage", Text: "first child reply"}
	if cursor == "" {
		return agent.ChildPage{Entries: []agent.HistoryEntry{entry}, Next: "more"}, nil
	}
	return agent.ChildPage{Entries: []agent.HistoryEntry{entry, {TurnID: "2", ItemID: "1", Kind: "agentMessage", Text: "second child reply"}}}, nil
}

func TestInspectorLoadsChildPagesOnClick(t *testing.T) {
	a := &historyAgent{Agent: fake.New(func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ToolStarted{NativeThread: "fake-native-1", ToolID: "delegation", ChildThread: "child", Name: "agent", Input: json.RawMessage(`{"description":"child"}`)})
		emit(agent.ToolFinished{ToolID: "delegation"})
	})}
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{a}})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	ws, _ := w.AddWorkspace(t.TempDir())
	session, _ := w.NewSession(ws.ID, fake.Kind, "")
	if err := w.Send(session.ID, "delegate"); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(3 * time.Second); w.Status(session.ID).Running; {
		if time.Now().After(deadline) {
			t.Fatal("turn timeout")
		}
		time.Sleep(time.Millisecond)
	}
	sh := New(w, Options{Only: session.ID})
	defer sh.Close()
	tt := ui.NewTester(sh.View, 950, 700)
	click := func(text string) {
		t.Helper()
		if err := tt.Click(text); err != nil {
			t.Fatal(err, tt.Texts())
		}
		tt.Frame()
		tt.Frame()
	}
	wait := func(text string) {
		t.Helper()
		for end := time.Now().Add(2 * time.Second); time.Now().Before(end); {
			tt.Frame()
			if tt.HasText(text) {
				return
			}
			time.Sleep(time.Millisecond)
		}
		t.Fatal(text, tt.Texts())
	}
	click("会话详情")
	click("子 Agent 活动")
	msgs, _ := w.Messages(session.ID)
	item := workbench.Activities(msgs, workbench.Delegations)[0]
	click("#" + item.ID + " · " + gist(item.Message.Tool.Input))
	if a.reads.Load() != 0 {
		t.Fatal("opening the local call eagerly read native history")
	}
	click("子会话历史")
	wait("first child reply")
	if a.reads.Load() != 1 {
		t.Fatal("unexpected eager page read")
	}
	click("加载更多轮次")
	wait("second child reply")
	click("返回")
	wait("已记录步骤")
	if a.reads.Load() != 2 {
		t.Fatal("pagination read count", a.reads.Load())
	}
}
