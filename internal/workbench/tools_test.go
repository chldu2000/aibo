package workbench_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestToolCallsThinkingPlansAndSubagents(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	ws, s := newSession(t, b)

	b.Send(s.ID, "看看项目")
	code := 0
	sc.emit(
		agent.ThinkingDelta{ReplyID: "m1", Text: "先列出"},
		agent.ThinkingDelta{ReplyID: "m1", Text: "文件"},
		agent.ReplyDelta{ReplyID: "m1", Text: "我来看看。"},
		agent.ReplyDone{ReplyID: "m1"},
		agent.PlanUpdated{PlanID: "plan", Items: []agent.PlanItem{{Text: "读代码", Status: agent.PlanInProgress}, {Text: "写总结", Status: agent.PlanPending}}},
		agent.ToolStarted{ToolID: "t1", Name: "Read", Input: json.RawMessage(`{"file_path":"go.mod"}`)},
	)
	b.waitFor(t, "the tool call", func() bool { return len(b.messages(t, s.ID)) == 4 })
	if m := b.messages(t, s.ID)[3]; m.Kind != model.ToolCall || m.State != model.Streaming || m.Tool.Name != "Read" || m.Tool.Done {
		t.Errorf("running tool call = %+v", m)
	}
	sc.emit(
		agent.ToolFinished{ToolID: "t1", Output: "module x"},
		agent.ToolStarted{ToolID: "agent1", Name: "Agent", Input: json.RawMessage(`{"prompt": "数一下文件"}`)},
		agent.ToolStarted{ToolID: "c1", Parent: "agent1", Name: "Bash", Input: json.RawMessage(`{"command": "ls | wc -l"}`)},
		agent.ToolFinished{ToolID: "c1", Parent: "agent1", Output: "3", ExitCode: &code},
		agent.ReplyDelta{ReplyID: "cm", Parent: "agent1", Text: "共 3 个文件"},
		agent.ReplyDone{ReplyID: "cm", Parent: "agent1"},
		agent.ToolFinished{ToolID: "agent1", Output: "3 个文件"},
		agent.PlanUpdated{PlanID: "plan", Items: []agent.PlanItem{{Text: "读代码", Status: agent.PlanCompleted}, {Text: "写总结", Status: agent.PlanInProgress}}},
		agent.ToolStarted{ToolID: "big", Name: "Bash", Input: json.RawMessage(`{"command": "yes"}`)},
		agent.ToolFinished{ToolID: "big", Output: strings.Repeat("y\n", model.MaxToolOutput), IsError: true},
		agent.ToolStarted{ToolID: "never", Name: "Bash", Input: json.RawMessage(`{"command": "sleep 99"}`)},
	)
	sc.endTurn()
	b.idle(t, s.ID)

	check := func(ms []model.Message) {
		t.Helper()
		calls := workbench.Activities(ms, workbench.Commands)
		if len(calls) != 3 || calls[2].ID != "5.1" || calls[2].Active ||
			calls[2].Message.Tool.ExitCode == nil || *calls[2].Message.Tool.ExitCode != 0 {
			t.Fatalf("command history did not preserve nested call identity and exit status")
		}
		kinds := ""
		for _, m := range ms {
			kinds += string(m.Kind) + " "
		}
		if kinds != "user reply plan tool tool tool tool " {
			t.Fatalf("messages are %s", kinds)
		}
		reply, plan, read, sub, big, never := ms[1], ms[2], ms[3], ms[4], ms[5], ms[6]
		if reply.Thinking != "先列出文件" || reply.Text != "我来看看。" || reply.State != model.Done {
			t.Errorf("reply = %+v", reply)
		}
		// The plan updated in place.
		if plan.Seq != 3 || len(plan.Plan) != 2 || plan.Plan[0].Status != agent.PlanCompleted || plan.Text != "- [x] 读代码\n- [~] 写总结" {
			t.Errorf("plan = %+v", plan)
		}
		if read.State != model.Done || !read.Tool.Done || read.Tool.Output != "module x" || string(read.Tool.Input) != `{"file_path":"go.mod"}` {
			t.Errorf("read = %+v %+v", read, read.Tool)
		}
		// The subagent's messages are in its call, without numbers.
		if sub.Seq != 5 || len(sub.Children) != 2 || sub.Children[0].Tool.Name != "Bash" || sub.Children[0].Tool.Output != "3" ||
			sub.Children[1].Text != "共 3 个文件" || sub.Children[1].State != model.Done || sub.Children[0].Seq != 0 {
			t.Errorf("subagent call = %+v", sub)
		}
		if !big.Tool.Truncated || len(big.Tool.Output) != model.MaxToolOutput || !big.Tool.IsError {
			t.Errorf("big output: truncated %v, %d bytes", big.Tool.Truncated, len(big.Tool.Output))
		}
		// The turn ended without its result.
		if never.State != model.Interrupted || never.Tool.Done {
			t.Errorf("unfinished tool call = %+v", never)
		}
	}
	check(b.messages(t, s.ID))
	b.Close()

	sc2 := newScript()
	b2 := open(t, dir, sc2.respond)
	defer b2.Close()
	check(b2.messages(t, s.ID))

	// The read tools show tool calls as name, input and result, and search
	// finds what they returned.
	tgt, _ := b2.NewSession(ws.ID, fake.Kind, "")
	r, _ := b2.ReferenceRange(s.ID, 1, 5, tgt.ID)
	converse(t, b2, sc2, tgt.ID, "读")
	_, opts := lastTurn(sc2)
	text, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	for _, want := range []string{
		"### [4] 工具调用 · ", "工具：Read\n参数：{\"file_path\":\"go.mod\"}\n结果：\nmodule x",
		"### [3] 计划 · ", "- [x] 读代码",
		"子代理调用：工具：Bash", "子代理回复：共 3 个文件",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("read lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "先列出文件") {
		t.Error("thinking read without asking")
	}
	hits, _ := call(t, opts, "search_reference", map[string]any{"query": "module x"})
	if got := strings.Join(hitsOf(hits), ","); got != r.ID+"#4" {
		t.Errorf("search of tool output: %s\n%s", got, hits)
	}
}

func TestInterruptedTurnInterruptsItsToolCall(t *testing.T) {
	sc := newScript()
	b := open(t, t.TempDir(), sc.respond)
	defer b.Close()
	_, s := newSession(t, b)
	b.Send(s.ID, "跑")
	sc.emit(agent.ToolStarted{ToolID: "t", Name: "Bash", Input: json.RawMessage(`{}`)})
	b.waitFor(t, "the tool call", func() bool { return len(b.messages(t, s.ID)) == 2 })
	b.Stop(s.ID)
	b.idle(t, s.ID)
	if m := b.messages(t, s.ID)[1]; m.State != model.Interrupted {
		t.Errorf("tool call after stop = %+v", m)
	}
}
