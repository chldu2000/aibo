package codex

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

func labels(opts []agent.ApprovalOption) string {
	var ls []string
	for _, o := range opts {
		ls = append(ls, o.ID+"="+o.Label)
	}
	return strings.Join(ls, " | ")
}

func answer(t *testing.T, k ask, opt string) string {
	t.Helper()
	r, err := k.result(opt)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(r)
	return string(b)
}

// Requests shaped as codex app-server 0.169.0's schema describes them.
func TestApprovalRequests(t *testing.T) {
	th := newThread()
	cmd, k, ok := th.approval("codex-7", askCommand, json.RawMessage(`{"threadId":"T","turnId":"U","itemId":"c1","command":"npm install left-pad","cwd":"/w","reason":"needs network","proposedExecpolicyAmendment":["npm","install"]}`))
	if !ok || cmd.ToolID != "c1" || cmd.Title != "执行命令" || cmd.Command != "npm install left-pad" || cmd.Cwd != "/w" || cmd.Reason != "needs network" {
		t.Fatalf("command approval = %+v", cmd)
	}
	if got := labels(cmd.Options); got != "accept=批准本次 | acceptForSession=本会话内始终允许 | always=永久允许（以 npm install 开头的命令） | decline=拒绝 | cancel=拒绝并停止" {
		t.Errorf("options: %s", got)
	}
	for opt, want := range map[string]string{
		"accept":           `{"decision":"accept"}`,
		"acceptForSession": `{"decision":"acceptForSession"}`,
		"always":           `{"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["npm","install"]}}}`,
		"decline":          `{"decision":"decline"}`,
		"cancel":           `{"decision":"cancel"}`,
	} {
		if got := answer(t, k, opt); got != want {
			t.Errorf("%s → %s, want %s", opt, got, want)
		}
	}

	// A file change shows the diff of the item it gates.
	th.handle("item/started", json.RawMessage(`{"threadId":"T","turnId":"U","item":{"type":"fileChange","id":"f1","status":"inProgress","changes":[{"path":"/w/a.go","kind":{"type":"update"},"diff":"@@ -1 +1 @@\n-a\n+b\n"}]}}`))
	fc, k, ok := th.approval("codex-8", askFileChange, json.RawMessage(`{"threadId":"T","turnId":"U","itemId":"f1","reason":null}`))
	if !ok || fc.Title != "修改文件" || fc.Diff != "--- /w/a.go\n+++ /w/a.go\n@@ -1 +1 @@\n-a\n+b" || len(fc.Paths) != 1 || fc.Paths[0] != "/w/a.go" {
		t.Errorf("file approval = %+v", fc)
	}
	if got := labels(fc.Options); got != "accept=批准本次 | acceptForSession=本会话内始终允许 | decline=拒绝 | cancel=拒绝并停止" {
		t.Errorf("options: %s", got)
	}
	if _, err := k.result("always"); err == nil {
		t.Error("a file change has no permanent option")
	}

	mcp, k, ok := th.approval("codex-9", askElicitation, json.RawMessage(`{"threadId":"T","turnId":"U","serverName":"github","message":"Allow create_issue?"}`))
	if !ok || mcp.Title != "调用 MCP 工具（github）" || mcp.Reason != "Allow create_issue?" || labels(mcp.Options) != "accept=批准本次 | decline=拒绝 | cancel=拒绝并停止" {
		t.Errorf("mcp approval = %+v", mcp)
	}
	if got := answer(t, k, "decline"); got != `{"action":"decline"}` {
		t.Errorf("mcp decline → %s", got)
	}
	if _, _, ok := th.approval("x", "item/permissions/requestApproval", json.RawMessage(`{}`)); ok {
		t.Error("a permissions request is asked")
	}
}

// "For the session" answers carry rules that, after the thread started
// again, answer the same requests without asking.
func TestSessionRules(t *testing.T) {
	th := newThread()
	cmd, _, _ := th.approval("1", askCommand, json.RawMessage(`{"itemId":"c","command":"go test ./...","cwd":"/w"}`))
	rules := cmd.Options[1].Rules
	if cmd.Options[1].Kind != agent.AllowSession || len(rules) != 1 || rules[0].Label != "命令 go test ./..." {
		t.Fatalf("session option = %+v", cmd.Options[1])
	}
	th.handle("item/started", json.RawMessage(`{"item":{"type":"fileChange","id":"f","changes":[{"path":"/w/a.go","kind":{"type":"update"},"diff":"x"}]}}`))
	fc, _, _ := th.approval("2", askFileChange, json.RawMessage(`{"itemId":"f"}`))
	rules = append(rules, fc.Options[1].Rules...)

	same, _, _ := th.approval("3", askCommand, json.RawMessage(`{"itemId":"c2","command":"go test ./..."}`))
	other, _, _ := th.approval("4", askCommand, json.RawMessage(`{"itemId":"c3","command":"go test ./... && rm -rf /"}`))
	if !allowed(rules, same, askCommand) || allowed(rules, other, askCommand) {
		t.Error("a command rule allows only that command")
	}
	th.handle("item/started", json.RawMessage(`{"item":{"type":"fileChange","id":"g","changes":[{"path":"/w/a.go","kind":{"type":"update"},"diff":"y"}]}}`))
	th.handle("item/started", json.RawMessage(`{"item":{"type":"fileChange","id":"h","changes":[{"path":"/w/b.go","kind":{"type":"update"},"diff":"z"}]}}`))
	again, _, _ := th.approval("5", askFileChange, json.RawMessage(`{"itemId":"g"}`))
	elsewhere, _, _ := th.approval("6", askFileChange, json.RawMessage(`{"itemId":"h"}`))
	if !allowed(rules, again, askFileChange) || allowed(rules, elsewhere, askFileChange) {
		t.Error("a files rule allows only those files")
	}
	if allowed(rules, same, askFileChange) {
		t.Error("a command rule allowed a file change")
	}
}

func TestPolicies(t *testing.T) {
	for level, want := range map[agent.ApprovalLevel]string{
		agent.AskAlways: "on-request workspace-write", agent.AcceptEdits: "on-request workspace-write", agent.FullAuto: "never danger-full-access",
	} {
		p, s := policies(level)
		if p+" "+s != want {
			t.Errorf("%s → %s %s", level, p, s)
		}
	}
}

// As codex app-server 0.169.0 reported compactions: its own, and asked for.
func TestCompaction(t *testing.T) {
	th := newThread()
	item := json.RawMessage(`{"threadId":"T","turnId":"U","item":{"type":"contextCompaction","id":"c","startedAtMs":1,"completedAtMs":2}}`)
	if evs := th.handle("item/completed", item); len(evs) != 1 || evs[0] != (agent.Compacted{Trigger: "auto"}) {
		t.Errorf("auto: %#v", evs)
	}
	th.compacting = true
	if evs := th.handle("item/completed", item); len(evs) != 1 || evs[0] != (agent.Compacted{Trigger: "manual"}) {
		t.Errorf("manual: %#v", evs)
	}
	th.handle("turn/completed", json.RawMessage(`{"threadId":"T","turn":{"id":"U","status":"completed"}}`))
	if th.compacting {
		t.Error("still compacting after the turn")
	}
}

// As codex app-server 0.169.0 answered a turn signed out: 401s while it
// retries.
func TestSignedOut(t *testing.T) {
	th := newThread()
	retry := json.RawMessage(`{"threadId":"T","turnId":"U","error":{"message":"Reconnecting... 2/5","codexErrorInfo":{"responseStreamDisconnected":{"httpStatusCode":401}},"additionalDetails":"401 Unauthorized"},"willRetry":true}`)
	evs := th.handle("error", retry)
	if len(evs) != 2 {
		t.Fatalf("events = %#v", evs)
	}
	if _, ok := evs[0].(agent.NotLoggedIn); !ok {
		t.Errorf("event 0 = %#v", evs[0])
	}
	if evs := th.handle("error", retry); len(evs) != 0 {
		t.Errorf("told twice: %#v", evs)
	}
	other := json.RawMessage(`{"threadId":"T","turnId":"U","error":{"message":"Reconnecting... 1/5","codexErrorInfo":{"responseStreamDisconnected":{"httpStatusCode":503}}},"willRetry":true}`)
	th.handle("turn/completed", json.RawMessage(`{"threadId":"T","turn":{"id":"U","status":"failed"}}`))
	evs = th.handle("error", other)
	if len(evs) != 1 || evs[0] != (agent.Retrying{Message: "Reconnecting... 1/5"}) {
		t.Errorf("a 503 being retried: %#v", evs)
	}
}
