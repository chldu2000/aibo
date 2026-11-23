package claude

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// Requests as Claude Code 2.1.318 sent them.
const (
	bashAsk  = `{"type":"control_request","request_id":"r1","request":{"subtype": "can_use_tool", "tool_name": "Bash", "display_name": "Bash", "input": {"command": "touch a.txt", "description": "Create empty file a.txt"}, "description": "Create empty file a.txt", "permission_suggestions": [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "touch a.txt"}], "behavior": "allow", "destination": "localSettings"}, {"type": "addDirectories", "directories": ["/private/tmp/aibo-10/ws"], "destination": "session"}, {"type": "setMode", "mode": "acceptEdits", "destination": "session"}], "blocked_path": "/private/tmp/aibo-10/ws/a.txt", "tool_use_id": "toolu_01A"}}`
	writeAsk = `{"type":"control_request","request_id":"r2","request":{"subtype": "can_use_tool", "tool_name": "Write", "display_name": "Write", "input": {"file_path": "/private/tmp/aibo-10/ws/b.txt", "content": "hi\nthere"}, "description": "b.txt", "permission_suggestions": [{"type": "setMode", "mode": "acceptEdits", "destination": "session"}], "tool_use_id": "toolu_01B"}}`
)

func ask(t *testing.T, p *parser, line string) agent.ApprovalRequested {
	t.Helper()
	evs := p.line([]byte(line))
	if len(evs) != 1 {
		t.Fatalf("events = %#v", evs)
	}
	a, ok := evs[0].(agent.ApprovalRequested)
	if !ok {
		t.Fatalf("event = %#v", evs[0])
	}
	return a
}

func labels(opts []agent.ApprovalOption) string {
	var ls []string
	for _, o := range opts {
		l := o.ID + "=" + string(o.Kind)
		var gs []string
		for _, g := range o.Grants {
			gs = append(gs, strings.TrimSpace(string(g.Kind)+" "+strings.Join(g.Items, " ")))
		}
		if len(gs) > 0 {
			l += "[" + strings.Join(gs, "; ") + "]"
		}
		ls = append(ls, l)
	}
	return strings.Join(ls, " | ")
}

func TestCanUseToolBecomesAnApproval(t *testing.T) {
	p := newParser()
	a := ask(t, p, bashAsk)
	if a.ID != "r1" || a.ToolID != "toolu_01A" || a.Action != agent.ActionCommand || a.Command != "touch a.txt" || a.Reason != "Create empty file a.txt" ||
		len(a.Paths) != 1 || a.Paths[0] != "/private/tmp/aibo-10/ws/a.txt" {
		t.Errorf("bash approval = %+v", a)
	}
	if got := labels(a.Options); got != "once=allow_once | session=allow_session[tools Bash(touch a.txt); directories /private/tmp/aibo-10/ws; accept_edits] | always=allow_always[tools Bash(touch a.txt)] | deny=deny | stop=deny_stop" {
		t.Errorf("options: %s", got)
	}
	if r := a.Options[1].Rules; len(r) != 3 || r[0].Grant.Items[0] != "Bash(touch a.txt)" || r[2].Grant.Kind != agent.GrantAcceptEdits {
		t.Errorf("session option's rules = %+v", r)
	}
	if a.Options[2].Where != ".claude/settings.local.json" {
		t.Errorf("always writes to %q", a.Options[2].Where)
	}

	w := ask(t, p, writeAsk)
	if w.Action != agent.ActionEdit || w.Diff != "--- /private/tmp/aibo-10/ws/b.txt\n+++ /private/tmp/aibo-10/ws/b.txt\n+hi\n+there" {
		t.Errorf("write approval = %+v", w)
	}
	// No rule for a settings file: no permanent option.
	if got := labels(w.Options); got != "once=allow_once | session=allow_session[accept_edits] | deny=deny | stop=deny_stop" {
		t.Errorf("options: %s", got)
	}
}

func TestResponses(t *testing.T) {
	p := newParser()
	ask(t, p, bashAsk)
	r := p.asks["r1"]
	get := func(opt, note string) map[string]any {
		t.Helper()
		resp, err := response(r, opt, note)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(resp)
		var m map[string]any
		json.Unmarshal(b, &m)
		return m
	}
	if m := get(optOnce, ""); m["behavior"] != "allow" || m["updatedPermissions"] != nil || m["updatedInput"].(map[string]any)["command"] != "touch a.txt" {
		t.Errorf("once = %v", m)
	}
	session := get(optSession, "")["updatedPermissions"].([]any)
	if len(session) != 3 {
		t.Fatalf("session = %v", session)
	}
	for _, s := range session {
		if s.(map[string]any)["destination"] != "session" {
			t.Errorf("a session permission goes to %v", s)
		}
	}
	always := get(optAlways, "")["updatedPermissions"].([]any)
	if len(always) != 1 || always[0].(map[string]any)["destination"] != "localSettings" || always[0].(map[string]any)["type"] != "addRules" {
		t.Errorf("always = %v", always)
	}
	if m := get(optDeny, "别动"); m["behavior"] != "deny" || m["message"] != "用户拒绝了这个操作：别动" || m["interrupt"] != false {
		t.Errorf("deny = %v", m)
	}
	if m := get(optStop, ""); m["interrupt"] != true || m["message"] != "用户拒绝了这个操作。" {
		t.Errorf("stop = %v", m)
	}
	if _, err := response(r, "nope", ""); err == nil {
		t.Error("an unknown option answered")
	}
}

func TestDeniedAndStoppedIsAnInterruption(t *testing.T) {
	p := newParser()
	evs := p.line([]byte(`{"type":"result","subtype":"error_during_execution","is_error":true,"terminal_reason":"aborted_tools","errors":["x"]}`))
	if len(evs) != 1 || evs[0] != (agent.TurnEnded{Interrupted: true}) {
		t.Errorf("events = %#v", evs)
	}
}

// As Claude Code 2.1.318 reported a /compact.
func TestCompactBoundary(t *testing.T) {
	p := newParser()
	evs := p.line([]byte(`{"type": "system", "subtype": "compact_boundary", "session_id": "s", "compact_metadata": {"trigger": "manual", "pre_tokens": 19360, "post_tokens": 7030, "cumulative_dropped_tokens": 12330, "duration_ms": 2864}}`))
	if len(evs) != 1 || evs[0] != (agent.Compacted{Trigger: "manual", PreTokens: 19360, PostTokens: 7030}) {
		t.Errorf("events = %#v", evs)
	}
	// What follows is no message of the session's.
	for _, l := range []string{
		`{"type":"user","message":{"role":"user","content":"This session is being continued from a previous conversation..."}}`,
		`{"type":"user","message":{"role":"user","content":"<local-command-stdout>Compacted </local-command-stdout>"}}`,
	} {
		if evs := p.line([]byte(l)); len(evs) != 0 {
			t.Errorf("%s → %#v", l, evs)
		}
	}
}

// As Claude Code 2.1.318 answered a turn signed out: a made-up reply,
// then an error result.
func TestSignedOut(t *testing.T) {
	p := newParser()
	var evs []agent.Event
	for _, l := range []string{
		`{"type":"system","subtype":"init","session_id":"s","apiKeySource":"none"}`,
		`{"type":"assistant","error":"authentication_failed","message":{"id":"m","model":"<synthetic>","content":[{"type":"text","text":"Not logged in · Please run /login"}]},"is_api_error_message":true}`,
		`{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error","result":"Not logged in · Please run /login"}`,
	} {
		evs = append(evs, p.line([]byte(l))...)
	}
	// Signed out, the session says how to sign in: no failure besides.
	if len(evs) != 3 {
		t.Fatalf("events = %#v", evs)
	}
	if _, ok := evs[1].(agent.NotLoggedIn); !ok {
		t.Errorf("event 1 = %#v", evs[1])
	}
	if evs[2] != (agent.TurnEnded{}) {
		t.Errorf("event 2 = %#v", evs[2])
	}
}

// As Claude Code 2.1.318 builds it from its API errors.
func TestAPIRetry(t *testing.T) {
	p := newParser()
	evs := p.line([]byte(`{"type":"system","subtype":"api_retry","attempt":2,"max_retries":10,"retry_delay_ms":1200,"error_status":529,"error":"overloaded_error","session_id":"s"}`))
	if len(evs) != 1 || evs[0] != (agent.Retrying{Attempt: 2, Max: 10, Message: "529 overloaded_error"}) {
		t.Errorf("events = %#v", evs)
	}
	evs = p.line([]byte(`{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":null,"error":"unknown","session_id":"s"}`))
	if len(evs) != 1 || evs[0] != (agent.Retrying{Attempt: 1, Max: 10, Message: "unknown"}) {
		t.Errorf("events = %#v", evs)
	}
}
