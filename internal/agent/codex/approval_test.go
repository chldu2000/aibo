package codex

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

func labels(opts []agent.ApprovalOption) string {
	var ls []string
	for _, o := range opts {
		l := o.ID + "=" + string(o.Kind)
		for _, g := range o.Grants {
			l += "[" + string(g.Kind) + " " + strings.Join(g.Items, " ") + "]"
		}
		ls = append(ls, l)
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
	if !ok || cmd.ToolID != "c1" || cmd.Action != agent.ActionCommand || cmd.Command != "npm install left-pad" || cmd.Cwd != "/w" || cmd.Reason != "needs network" {
		t.Fatalf("command approval = %+v", cmd)
	}
	if got := labels(cmd.Options); got != "accept=allow_once | acceptForSession=allow_session[command npm install left-pad] | always=allow_always[command_prefix npm install] | decline=deny | cancel=deny_stop" {
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
	if !ok || fc.Action != agent.ActionEdit || fc.Diff != "--- /w/a.go\n+++ /w/a.go\n@@ -1 +1 @@\n-a\n+b" || len(fc.Paths) != 1 || fc.Paths[0] != "/w/a.go" {
		t.Errorf("file approval = %+v", fc)
	}
	if got := labels(fc.Options); got != "accept=allow_once | acceptForSession=allow_session[edits /w/a.go] | decline=deny | cancel=deny_stop" {
		t.Errorf("options: %s", got)
	}
	if _, err := k.result("always"); err == nil {
		t.Error("a file change has no permanent option")
	}

	mcp, k, ok := th.approval("codex-9", askElicitation, json.RawMessage(`{"threadId":"T","turnId":"U","serverName":"github","message":"Allow create_issue?"}`))
	if !ok || mcp.Action != agent.ActionMCP || mcp.Tool != "github" || mcp.Reason != "Allow create_issue?" || labels(mcp.Options) != "accept=allow_once | decline=deny | cancel=deny_stop" {
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
	if cmd.Options[1].Kind != agent.AllowSession || len(rules) != 1 || rules[0].Grant.Kind != agent.GrantCommand || rules[0].Grant.Items[0] != "go test ./..." {
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

// What thread/start answered (codex-cli 0.169.0, research/11), asked for
// each preset's settings, its default (in an untrusted folder: Read only)
// and settings no preset has: each answer is its preset, or none.
func TestPresets(t *testing.T) {
	b, err := os.ReadFile("testdata/modes.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"read-only", "read-only", "ask-for-approval", "approve-for-me", "full-access", ""}
	for i, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var rec struct{ Params, Result json.RawMessage }
		json.Unmarshal([]byte(line), &rec)
		if got := threadMode(rec.Result); got != want[i] {
			t.Errorf("%s → %q, want %q", rec.Params, got, want[i])
		}
	}
	// What a preset asks for at thread/start is what it is reported as.
	for _, p := range presets {
		if got := modeOf(p.policy, p.reviewer, sandboxTypes[p.sandbox]); got != p.mode.ID {
			t.Errorf("%s comes back as %q", p.mode.ID, got)
		}
	}
	s := &session{id: "T"}
	if err := s.SetMode(context.Background(), "yolo"); err == nil {
		t.Error("an unknown mode")
	}
	s.SetMode(context.Background(), "approve-for-me")
	p := s.turnParams("x", nil)
	if p["approvalPolicy"] != "on-request" || p["approvalsReviewer"] != "auto_review" || p["sandboxPolicy"].(map[string]any)["type"] != "workspaceWrite" {
		t.Errorf("turn/start after SetMode: %v", p)
	}
	if p := s.turnParams("y", nil); p["approvalPolicy"] != nil {
		t.Errorf("then: %v", p)
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
	if len(evs) != 1 {
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
