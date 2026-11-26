package contract

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/acp"
	"github.com/chldu2000/aibo/internal/agent/fake"
	registry "github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
)

// cursor finds the installed, signed-in Cursor CLI, with its settings in
// a directory of the test's own (CURSOR_CONFIG_DIR): what aibo chooses
// would otherwise become the user's own Cursor defaults. Its sign-in is
// not kept there, and still holds. It fails the test if the user's own
// settings change.
func cursor(t *testing.T) (*registry.Registry, registry.Status, *acp.Agent) {
	t.Helper()
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run the Cursor CLI")
	}
	home, _ := os.UserHomeDir()
	own := filepath.Join(home, ".cursor", "cli-config.json")
	if dir := os.Getenv("CURSOR_CONFIG_DIR"); dir != "" {
		own = filepath.Join(dir, "cli-config.json")
	}
	before, _ := os.ReadFile(own)
	t.Cleanup(func() {
		if after, _ := os.ReadFile(own); string(after) != string(before) {
			t.Errorf("the user's own Cursor settings (%s) changed", own)
		}
	})
	t.Setenv("CURSOR_CONFIG_DIR", t.TempDir())
	r := registry.New(registry.Options{})
	r.Check(t.Context(), registry.Cursor)
	st := r.Status(registry.Cursor)
	switch st.State {
	case registry.NotInstalled:
		t.Skipf("the Cursor CLI is not installed: %+v", st)
	case registry.NotLoggedIn:
		t.Skip("the Cursor CLI is signed out: run cursor-agent login")
	case registry.Ready:
	default:
		t.Fatalf("the Cursor CLI is unusable: %+v", st)
	}
	t.Logf("Cursor CLI %s at %s", st.Version, st.Path)
	for _, a := range r.Agents() {
		if a, ok := a.(*acp.Agent); ok && a.Kind() == registry.Cursor {
			return r, st, a
		}
	}
	t.Fatal("no Cursor adapter")
	return nil, st, nil
}

// sessionsOf asks a new Cursor CLI process for its sessions in dir.
func sessionsOf(t *testing.T, st registry.Status, dir string) []string {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, st.Path, append(slices.Clone(st.Args), "acp")...)
	cmd.Dir = dir
	in, _ := cmd.StdinPipe()
	out, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	sc := bufio.NewScanner(out)
	sc.Buffer(nil, 1<<24)
	call := func(id int, method string, params any) json.RawMessage {
		b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
		in.Write(append(b, '\n'))
		for sc.Scan() {
			var m struct {
				ID     int
				Result json.RawMessage
				Error  json.RawMessage
			}
			if json.Unmarshal(sc.Bytes(), &m) == nil && m.ID == id {
				if m.Error != nil {
					t.Fatalf("%s: %s", method, m.Error)
				}
				return m.Result
			}
		}
		t.Fatalf("%s: no answer", method)
		return nil
	}
	call(1, "initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	var list struct{ Sessions []struct{ SessionID string } }
	json.Unmarshal(call(2, "session/list", map[string]any{"cwd": dir}), &list)
	var ids []string
	for _, s := range list.Sessions {
		ids = append(ids, s.SessionID)
	}
	return ids
}

// Read the installed Cursor CLI's models and modes, as aibo's probe does,
// and switch the model, effort and mode, without sending a prompt.
// AIBO_CURSOR_EFFORT_MODEL names a model that takes efforts low and high
// (the default, claude-opus-5-5, in 2026.11.22).
func TestContractCursorSettings(t *testing.T) {
	_, st, a := cursor(t)
	m := os.Getenv("AIBO_CURSOR_EFFORT_MODEL")
	if m == "" {
		m = "claude-opus-5-5"
	}
	ms, err := a.Models(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]agent.Model{}
	for _, x := range ms {
		ids[x.ID] = x
	}
	auto := ""
	for _, id := range []string{"default", "auto-smart"} {
		if _, ok := ids[id]; ok {
			auto = id
		}
	}
	if auto == "" || len(ms) < 2 {
		t.Fatalf("models %+v", ms)
	}
	if auto == "auto-smart" && !slices.Equal(ids[auto].Efforts, []string{"intelligence", "balanced", "cost"}) {
		t.Errorf("auto efforts %q", ids[auto].Efforts)
	}
	if x, ok := ids["claude-opus-5"]; ok && (slices.Contains(x.Efforts, "true") || !slices.Contains(x.Efforts, "high")) {
		t.Errorf("claude-opus-5 efforts %q", x.Efforts)
	}
	if _, ok := ids[m]; !ok {
		t.Fatalf("no model %s among %d", m, len(ms))
	}
	for _, x := range ms {
		if strings.Contains(x.ID, "[") {
			t.Errorf("a parameterized model value %q: the picker was not asked for", x.ID)
		}
	}
	modes, err := a.PermissionModes(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range modes {
		safe := x.ID == "plan" || x.ID == "ask"
		if x.ID == "agent" && (!x.Default || x.Risk != agent.Caution) || safe && (x.Risk != agent.Safe || !x.ReadOnly) {
			t.Errorf("mode %+v", x)
		}
	}
	// The probe's session is gone once its process is.
	probes, _ := filepath.Glob(filepath.Join(os.TempDir(), "aibo-acp-probe-*"))
	for _, dir := range probes {
		if left := sessionsOf(t, st, dir); len(left) > 0 {
			t.Errorf("the probe left sessions %v in %s", left, dir)
		}
	}

	ws := t.TempDir()
	s, err := a.Start(t.Context(), agent.StartOptions{Workspace: ws, Model: m, Effort: "high", Mode: "plan"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	settled := func() (set agent.SettingsReported, mode string) {
		for {
			select {
			case ev := <-s.Events():
				switch e := ev.(type) {
				case agent.SettingsReported:
					set = e
				case agent.ModeReported:
					mode = e.ID
				}
			case <-time.After(3 * time.Second):
				return
			}
		}
	}
	if set, mode := settled(); set.Model != m || set.Effort != "high" || mode != "plan" {
		t.Fatalf("started with %+v in %q", set, mode)
	}
	if err := s.SetModel(t.Context(), m, "low"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetMode(t.Context(), "agent"); err != nil {
		t.Fatal(err)
	}
	if set, mode := settled(); set.Effort != "low" || mode != "agent" {
		t.Fatalf("switched to %+v in %q", set, mode)
	}
	// Auto: default has no effort; auto-smart's menu is optimize_for.
	if err := s.SetModel(t.Context(), auto, ""); err != nil {
		t.Fatal(err)
	}
	if set, _ := settled(); set.Model != auto || auto == "default" && set.Effort != "" || auto == "auto-smart" && !slices.Contains([]string{"intelligence", "balanced", "cost"}, set.Effort) {
		t.Fatalf("on Auto: %+v", set)
	}
	if auto == "auto-smart" {
		if err := s.SetModel(t.Context(), auto, "cost"); err != nil {
			t.Fatal(err)
		}
		if set, _ := settled(); set.Effort != "cost" {
			t.Fatalf("auto cost: %+v", set)
		}
	}
	ms, _ = a.Models(t.Context())
	for _, x := range ms {
		if x.ID == m && (!slices.Contains(x.Efforts, "low") || !slices.Contains(x.Efforts, "high") || x.DefaultEffort != "") {
			t.Errorf("%s learned as %+v", m, x)
		}
	}
}

// Talk to the installed Cursor CLI through the workbench, on Auto: read a
// reference through aibo's MCP tool, run a command it asks to approve,
// refuse one, and go on after a restart. It uses the user's Cursor
// requests.
func TestContractCursor(t *testing.T) {
	r, _, _ := cursor(t)
	ws, dir := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(ws, "note.txt"), []byte("code: amber-otter-59\n"), 0o600); err != nil {
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
	latest := func(id string) string {
		t.Helper()
		if st := e.Status(id); st.Error != nil {
			t.Fatalf("turn error: %v", st.Error)
		}
		ms, _ := e.Messages(id)
		for i := len(ms) - 1; i >= 0; i-- {
			if ms[i].Kind == model.AgentReply {
				return ms[i].Text
			}
		}
		t.Fatal("missing agent reply")
		return ""
	}
	tools := func(id string) (out []*model.Tool) {
		ms, _ := e.Messages(id)
		for _, m := range ms {
			if m.Tool != nil {
				out = append(out, m.Tool)
			}
		}
		return out
	}
	source, target := newSession(fake.Kind), newSession(registry.Cursor)
	e.run(source, "The reference code is violet-lantern-73.", agent.Deny)
	ref, err := e.ReferenceSession(source, target)
	if err != nil {
		t.Fatal(err)
	}

	// The tool is not named: the brief aibo sends with the reference does.
	e.run(target, "Read the file note.txt in the current directory, and read the attached reference. Reply with both codes.", agent.AllowOnce)
	reply := latest(target)
	got, _ := e.Reference(ref.ID)
	for _, tool := range tools(target) {
		t.Logf("tool %q input %s", tool.Name, tool.Input)
	}
	if !strings.Contains(reply, "amber-otter-59") || !strings.Contains(reply, "violet-lantern-73") || len(got.Reads) == 0 {
		t.Fatalf("reads %d, reply %q", len(got.Reads), reply)
	}
	native, _ := e.Session(target)
	if native.NativeID() == "" {
		t.Fatal("no native session ID")
	}

	shell := func(cmd string) string {
		return "Use your shell tool to run exactly this single command in the current directory: " + cmd + ". Do not change it. After an approval refusal, stop and reply DENIED; never retry or use a different tool."
	}
	if err := e.Send(target, shell("echo AIBO-ALLOW")); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return e.pending(target) != nil || !e.Status(target).Running })
	approval := e.pending(target)
	if approval == nil || !strings.Contains(approval.Command, "echo AIBO-ALLOW") {
		t.Fatalf("expected an approval of echo, got %+v", approval)
	}
	var kinds []string
	choice := ""
	for _, o := range approval.Options {
		kinds = append(kinds, fmt.Sprint(o.Kind))
		if o.Kind == agent.AllowOnce {
			choice = o.ID
		}
	}
	t.Logf("approval %q, options %v", approval.Command, kinds)
	if choice == "" {
		t.Fatal("no allow-once choice")
	}
	if err := e.Approve(target, approval.ID, choice, ""); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return !e.Status(target).Running || e.pending(target) != nil })
	if n := e.run(target, shell("echo AIBO-DENY"), agent.Deny); n == 0 {
		t.Fatal("no approval asked for the refused command")
	}
	allowed, denied := false, false
	for _, tool := range tools(target) {
		if strings.Contains(tool.Output, "AIBO-ALLOW") {
			allowed = true
		}
		if tool.Declined {
			denied = true
		}
	}
	if !allowed || !denied {
		t.Fatalf("tool outcomes: allowed=%v denied=%v", allowed, denied)
	}

	// Restarted, the session goes on where it was (session/load).
	e.Close()
	e = openEnv(t, dir, as)
	e.run(target, "What was the code in note.txt? Reply with just the code.", agent.Deny)
	resumed, _ := e.Session(target)
	if reply := latest(target); resumed.NativeID() != native.NativeID() || !strings.Contains(reply, "amber-otter-59") {
		t.Fatalf("after a restart: same native ID=%v, reply=%q", resumed.NativeID() == native.NativeID(), reply)
	}
}
