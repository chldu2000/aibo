package agents_test

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
)

// This second ACP implementation deliberately offers load with replay only.
// The registry must be able to start it using only a configuration entry.
func TestConfiguredACP(t *testing.T) {
	dir := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cfg := []map[string]any{{"id": "replay", "name": "Replay agent", "command": exe, "args": []string{"-test.run=^TestACPExecutable$"}, "toolPrefix": "aibo."}}
	data, _ := json.Marshal(cfg)
	if err = os.WriteFile(filepath.Join(dir, "agents.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AIBO_TEST_ACP", "1")
	r, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	r.Check(t.Context(), "replay")
	if st := r.Status("replay"); st.State != agents.Ready || st.Path != exe {
		t.Fatal(st)
	}
	all := r.Agents()
	a := all[len(all)-1]
	if a.Kind() != "replay" || a.Name() != "Replay agent" || a.ToolName("read_reference") != "aibo.read_reference" {
		t.Fatal("lost configured identity")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
	defer cancel()
	s, err := a.Start(ctx, agent.StartOptions{Workspace: dir, ResumeID: "saved", MCP: &agent.MCPServer{URL: "http://localhost/new", Token: "fresh"}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	next := func() agent.Event {
		t.Helper()
		select {
		case e, ok := <-s.Events():
			if !ok {
				t.Fatal("early EOF")
			}
			return e
		case <-ctx.Done():
			t.Fatal(ctx.Err())
			return nil
		}
	}
	if e, ok := next().(agent.NativeSessionStarted); !ok || e.ID != "saved" {
		t.Fatalf("replay escaped: %+v", e)
	}
	if err := s.Send(ctx, agent.Turn{Images: []agent.Image{{Path: "absent"}}}); err == nil {
		t.Fatal("peer did not advertise images")
	}
	if err := s.Send(ctx, agent.Turn{Text: "inspect", Files: []agent.FileMention{{Rel: "notes.txt"}}}); err != nil {
		t.Fatal(err)
	}
	approval, ok := next().(agent.ApprovalRequested)
	if !ok || approval.ID != `t/"permission-7"` {
		t.Fatal(approval)
	}
	if err := s.Send(ctx, agent.Turn{}); !errors.Is(err, agent.ErrBusy) {
		t.Fatal(err)
	}
	if err := s.RespondApproval(ctx, approval.ID, "not-offered", ""); err == nil {
		t.Fatal("unknown option accepted")
	}
	if err := s.Interrupt(ctx); err != nil {
		t.Fatal(err)
	}
	if end, ok := next().(agent.TurnEnded); !ok || !end.Interrupted {
		t.Fatal(end)
	}
	if err := s.Send(ctx, agent.Turn{Text: "exit"}); err != nil {
		t.Fatal(err)
	}
	if e, ok := next().(agent.Failed); !ok || !e.Exited {
		t.Fatal(e)
	}
	if e, ok := next().(agent.TurnEnded); !ok || !e.Interrupted {
		t.Fatal(e)
	}
}

func TestACPExecutable(t *testing.T) {
	if os.Getenv("AIBO_TEST_ACP") != "1" {
		return
	}
	type frame struct {
		ID     json.RawMessage
		Method string
		Params struct {
			SessionID  string
			MCPServers []struct {
				URL     string
				Headers []struct{ Name, Value string }
			}
			Prompt []struct{ Text string }
		}
		Result struct{ Outcome struct{ Outcome string } }
	}
	sc := bufio.NewScanner(os.Stdin)
	read := func() frame {
		var m frame
		if !sc.Scan() || json.Unmarshal(sc.Bytes(), &m) != nil {
			os.Exit(11)
		}
		return m
	}
	write := func(id json.RawMessage, result any) {
		json.NewEncoder(os.Stdout).Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	}
	init := read()
	if init.Method != "initialize" {
		os.Exit(12)
	}
	write(init.ID, map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{"loadSession": true, "mcpCapabilities": map[string]bool{"http": true}}})
	load := read()
	servers := load.Params.MCPServers
	if load.Method != "session/load" || load.Params.SessionID != "saved" || len(servers) != 1 || servers[0].URL != "http://localhost/new" || len(servers[0].Headers) != 1 || servers[0].Headers[0].Value != "Bearer fresh" {
		os.Exit(13)
	}
	for range 200 {
		fmt.Println(`{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"saved","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"history"}}}}`)
	}
	write(load.ID, map[string]any{})
	turn := read()
	if turn.Method != "session/prompt" || len(turn.Params.Prompt) != 1 || turn.Params.Prompt[0].Text != "inspect\nnotes.txt" {
		os.Exit(14)
	}
	fmt.Println(`{"jsonrpc":"2.0","id":"permission-7","method":"session/request_permission","params":{"sessionId":"saved","toolCall":{"toolCallId":"t","kind":"read"},"options":[{"kind":"allow_once","optionId":"once"}]}}`)
	cancel := read()
	answer := read()
	if cancel.Method != "session/cancel" || string(answer.ID) != `"permission-7"` || answer.Result.Outcome.Outcome != "cancelled" {
		os.Exit(15)
	}
	write(turn.ID, map[string]string{"stopReason": "cancelled"})
	if read().Method != "session/prompt" {
		os.Exit(16)
	}
	os.Exit(7)
}

func TestInvalidACPConfiguration(t *testing.T) {
	dir := t.TempDir()
	for _, body := range []string{
		`[{"id":"codex","name":"X","command":"x"}]`, `[{"id":"fake","name":"X","command":"x"}]`,
		`[{"id":"x","command":"x"}]`, `[{"id":"x","name":"X","command":"./x"}]`,
		`[{"id":"x","name":"X","command":"x","arg":["serve"]}]`, `[] []`, `null`,
	} {
		if err := os.WriteFile(filepath.Join(dir, "agents.json"), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := agents.Open(dir, agents.Options{}); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
}

func TestAddACPPreservesExistingConfiguration(t *testing.T) {
	dir := t.TempDir()
	r, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "agents.json")
	// The user edited the file while aibo was open.
	initial := []byte(`[{"id":"existing","name":"Existing","command":"first"}]`)
	if err = os.WriteFile(path, initial, 0600); err != nil {
		t.Fatal(err)
	}
	c := agents.ACPConfig{ID: "existing", Name: "Another", Command: "other"}
	if _, err := r.AddACP(c); !errors.Is(err, agents.ErrIDInUse) {
		t.Fatalf("duplicate ID: %v", err)
	}
	if got, _ := os.ReadFile(path); string(got) != string(initial) {
		t.Fatal("rejected save changed the file")
	}
	c.ID = "another"
	if _, err = r.AddACP(c); err != nil {
		t.Fatal(err)
	}
	if _, err = r.AddACP(c); !errors.Is(err, agents.ErrIDInUse) {
		t.Fatal(err)
	}
	reopened, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if reopened.Status("another").Name != "Another" || reopened.Status("existing").Name != "Existing" {
		t.Fatal("missing saved Agent")
	}
	if err = os.WriteFile(path, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	c.ID = "retry"
	if _, err = r.AddACP(c); err == nil || r.Status(c.ID).Problem != agents.ProblemUnknown {
		t.Fatal("published an Agent after a failed save")
	}
	if got, _ := os.ReadFile(path); string(got) != "{" {
		t.Fatal("overwrote invalid configuration")
	}
}

func TestOpenCodeEditRemoveAndRestoreSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	reopen := func() *agents.Registry {
		t.Helper()
		r, err := agents.Open(dir, agents.Options{})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := reopen()
	cfg, _ := r.ACPConfig(agents.OpenCode)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cfg.Command, cfg.Args = exe, []string{"-test.run=^TestACPExecutable$"}
	if _, err := r.EditACP(cfg); err != nil {
		t.Fatal(err)
	}
	r = reopen()
	r.Check(t.Context(), agents.OpenCode)
	t.Setenv("AIBO_TEST_ACP", "1")
	adapter := r.Agents()[2]
	ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
	defer cancel()
	session, err := adapter.Start(ctx, agent.StartOptions{Workspace: dir, ResumeID: "saved", MCP: &agent.MCPServer{URL: "http://localhost/new", Token: "fresh"}})
	if err != nil {
		t.Fatal(err)
	}
	session.Close()
	if err := r.RemoveACP(agents.OpenCode); err != nil {
		t.Fatal(err)
	}
	r = reopen()
	if _, ok := r.ACPConfig(agents.OpenCode); ok || len(r.Agents()) != 2 {
		t.Fatal("deleted OpenCode returned after restart")
	}
	if _, err := r.RestoreOpenCode(); err != nil {
		t.Fatal(err)
	}
	r = reopen()
	got, ok := r.ACPConfig(agents.OpenCode)
	if !ok || len(r.Agents()) != 3 || got.Command != "opencode" || !slices.Equal(got.Args, []string{"acp"}) || got.ToolPrefix != nil {
		t.Fatalf("restored configuration = %+v", got)
	}
}

func TestACPExternalEditIsPreserved(t *testing.T) {
	dir := t.TempDir()
	r, err := agents.Open(dir, agents.Options{})
	if err != nil {
		t.Fatal(err)
	}
	cfg, _ := r.ACPConfig(agents.OpenCode)
	data := []byte(`[{"id":"opencode","name":"Edited outside","command":"opencode","args":["acp"]}]`)
	path := filepath.Join(dir, "agents.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.EditACP(cfg); !errors.Is(err, agents.ErrConfigChanged) {
		t.Fatal(err)
	}
	if err := r.RemoveACP(cfg.ID); !errors.Is(err, agents.ErrConfigChanged) {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != string(data) {
		t.Fatalf("external edit overwritten: %s, %v", got, err)
	}
}
