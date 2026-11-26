package contract

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	registry "github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
)

// Exercise the installed executable through the same discovery, MCP, storage,
// approval and recovery paths as the desktop app. Use only synthetic messages.
func TestContractOpenCode(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run OpenCode")
	}
	for _, key := range []string{"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"} {
		t.Setenv(key, t.TempDir())
	}
	t.Setenv("OPENCODE_DISABLE_AUTOUPDATE", "1")
	r := registry.New(registry.Options{})
	if p := os.Getenv("AIBO_OPENCODE"); p != "" {
		r.SetPath(t.Context(), registry.OpenCode, p)
	} else {
		r.Detect(t.Context())
	}
	st := r.Status(registry.OpenCode)
	if !st.Usable() {
		t.Fatalf("OpenCode unavailable: %+v", st)
	}
	t.Logf("OpenCode %s", st.Version)
	ws, dir := t.TempDir(), t.TempDir()
	permissions := `{"permissions":[{"action":"shell","resource":"*","effect":"ask"}]}`
	if strings.HasPrefix(st.Version, "1.") {
		permissions = `{"permission":{"bash":{"*":"ask"}}}`
	}
	if err := os.WriteFile(filepath.Join(ws, "opencode.json"), []byte(permissions), 0600); err != nil {
		t.Fatal(err)
	}
	as := append(r.Agents(), fake.New(func(_ context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "Recorded."})
	}))
	e := openEnv(t, dir, as)
	defer func() {
		if e != nil {
			e.Close()
		}
	}()
	space, err := e.AddWorkspace(ws)
	if err != nil {
		t.Fatal(err)
	}
	newSession := func(kind agent.Kind) string {
		x, err := e.NewSession(space.ID, kind, "")
		if err != nil {
			t.Fatal(err)
		}
		return x.ID
	}
	source, target := newSession(fake.Kind), newSession(registry.OpenCode)
	e.run(source, "Record the reference code.", agent.Deny)
	e.run(source, "The reference code is amber-otter-59.", agent.Deny)
	e.run(source, "End of record.", agent.Deny)
	ref, err := e.ReferenceSession(source, target)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ref.Brief, "amber-otter-59") {
		t.Fatal("reference code leaked into brief")
	}
	e.run(source, "The later code is LATE-900.", agent.Deny)
	latest := func(id string) string {
		t.Helper()
		if st := e.Status(id); st.Error != nil {
			t.Fatalf("turn error: %v", st.Error)
		}
		ms, err := e.Messages(id)
		if err != nil {
			t.Fatal(err)
		}
		for i := len(ms) - 1; i >= 0; i-- {
			if ms[i].Kind == model.AgentReply {
				return ms[i].Text
			}
		}
		t.Fatal("missing agent reply")
		return ""
	}
	e.run(target, "Call the aibo read_reference MCP tool for the attached reference and report its reference code. Remember the separate session word violet-lantern-73 for later.", agent.Deny)
	got, _ := e.Reference(ref.ID)
	if len(got.Reads) == 0 || !strings.Contains(latest(target), "amber-otter-59") {
		t.Fatal("reference body was not read and reported")
	}
	targetMessages, _ := e.Messages(target)
	readBody := false
	for _, m := range targetMessages {
		if m.Tool != nil {
			if strings.Contains(m.Tool.Output, "LATE-900") {
				t.Fatal("tool read beyond the reference boundary")
			}
			if strings.Contains(m.Tool.Output, "amber-otter-59") {
				readBody = true
			}
		}
	}
	if !readBody {
		t.Fatal("reference code absent from tool output")
	}
	native, _ := e.Session(target)
	if native.NativeID() == "" {
		t.Fatal("no native session ID")
	}
	other := newSession(registry.OpenCode)
	e.run(other, "Call your aibo read_reference MCP tool for ref_id "+ref.ID+". Report the result.", agent.Deny)
	if strings.Contains(latest(other), "amber-otter-59") {
		t.Fatal("second session received another session's reference")
	}
	otherMessages, _ := e.Messages(other)
	called := false
	for _, m := range otherMessages {
		if m.Tool != nil && (strings.Contains(string(m.Tool.Input), ref.ID) || strings.Contains(m.Tool.Output, ref.ID)) {
			if strings.Contains(m.Tool.Output, "amber-otter-59") {
				t.Fatal("unauthorized tool read returned the reference body")
			}
			called = true
		}
	}
	if !called {
		t.Fatal("second session did not use its tools")
	}
	now, _ := e.Reference(ref.ID)
	if len(now.Reads) != len(got.Reads) {
		t.Fatal("second session read the snapshot")
	}

	e.Close()
	e = nil
	e = openEnv(t, dir, as)
	e.run(target, "What was the separate session word I asked you to remember? Reply with just that word.", agent.Deny)
	resumed, _ := e.Session(target)
	if reply := latest(target); resumed.NativeID() != native.NativeID() || !strings.Contains(reply, "violet-lantern-73") {
		t.Fatalf("after restart: same native ID=%v, reply=%q", resumed.NativeID() == native.NativeID(), reply)
	}
	e.run(target, "Verify the live MCP connection by calling the aibo read_reference tool NOW with ref_id "+ref.ID+". Use the actual tool even if you recall its output. Return the code in the result.", agent.Deny)
	after, _ := e.Reference(ref.ID)
	if reply := latest(target); len(after.Reads) <= len(got.Reads) || !strings.Contains(reply, "amber-otter-59") {
		t.Fatalf("after restart: recorded reads %d -> %d, reply=%q", len(got.Reads), len(after.Reads), reply)
	}

	shell := func(cmd string) string {
		return "Use your shell tool to run exactly this single command in the current directory: " + cmd + ". Do not change it. After an approval refusal, stop and reply DENIED; never retry or use a different tool."
	}
	if err := e.Send(target, shell("echo AIBO-ALLOW")); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return e.pending(target) != nil || !e.Status(target).Running })
	approval := e.pending(target)
	if approval == nil || !strings.EqualFold(strings.TrimSpace(approval.Command), "echo AIBO-ALLOW") {
		t.Fatalf("expected echo approval, got %+v", approval)
	}
	choice := ""
	for _, o := range approval.Options {
		if o.Kind == agent.AllowOnce {
			choice = o.ID
		}
	}
	if choice == "" {
		t.Fatal("missing allow-once choice")
	}
	if err := e.Approve(target, approval.ID, choice, ""); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return !e.Status(target).Running || e.pending(target) != nil })
	if e.pending(target) != nil {
		t.Fatal("unexpected additional permission request")
	}
	if n := e.run(target, shell("echo AIBO-DENY"), agent.Deny); n == 0 {
		t.Fatal("no deny request")
	}
	ms, _ := e.Messages(target)
	allowed, denied := false, false
	for _, m := range ms {
		if m.Tool == nil {
			continue
		}
		if strings.Contains(m.Tool.Output, "AIBO-ALLOW") && m.Tool.ExitCode != nil && *m.Tool.ExitCode == 0 {
			allowed = true
		}
		if m.Tool.Declined && m.Tool.IsError {
			denied = true
		}
	}
	if !allowed || !denied {
		t.Fatalf("tool outcomes: allowed=%v denied=%v", allowed, denied)
	}
	if err := e.Send(other, "Use the shell tool to execute exactly one command: echo AIBO-STOP"); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return e.pending(other) != nil || !e.Status(other).Running })
	if e.pending(other) == nil {
		t.Fatalf("no pending request to interrupt; reply %q", latest(other))
	}
	if err := e.Stop(other); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return !e.Status(other).Running })
	if e.pending(other) != nil {
		t.Fatal("interrupted request is still pending")
	}
	e.run(other, "This is a new message after I interrupted the previous task. Acknowledge this message by replying exactly NEXT-OK. No tools are needed.", agent.Deny)
	if reply := latest(other); !strings.Contains(reply, "NEXT-OK") {
		t.Fatalf("next turn after interruption: %q", reply)
	}
}
