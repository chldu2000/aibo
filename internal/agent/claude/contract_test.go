package claude_test

// Contract tests with the real claude on this machine: off unless
// AIBO_CONTRACT=1, as they cost money and need a signed-in Claude Code.
// Rerun them whenever Claude Code updates.
//
//	AIBO_CONTRACT=1 CGO_ENABLED=0 go test ./internal/agent/claude -run Contract -v

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

// contractModel keeps the tests cheap.
const contractModel = "haiku"

func contract(t *testing.T) string {
	t.Helper()
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run against the real claude")
	}
	path, err := exec.LookPath("claude")
	if err != nil {
		t.Skip("no claude on PATH")
	}
	return path
}

type env struct {
	*workbench.Workbench
	changes chan struct{}
}

func openEnv(t *testing.T, dir, path string) *env {
	t.Helper()
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{claude.New(path)}})
	if err != nil {
		t.Fatal(err)
	}
	e := &env{Workbench: w, changes: make(chan struct{}, 4096)}
	w.Subscribe(func(workbench.Change) {
		select {
		case e.changes <- struct{}{}:
		default:
		}
	})
	return e
}

func (e *env) until(t *testing.T, what string, cond func() bool) {
	t.Helper()
	guard := time.After(3 * time.Minute)
	for !cond() {
		select {
		case <-e.changes:
		case <-guard:
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func (e *env) turn(t *testing.T, id, text string) []model.Message {
	t.Helper()
	if err := e.Send(id, text); err != nil {
		t.Fatal(err)
	}
	e.until(t, "the turn to end", func() bool { return !e.Status(id).Running })
	if st := e.Status(id); st.Error != "" {
		t.Fatalf("Claude Code reported: %s", st.Error)
	}
	ms, _ := e.Messages(id)
	return ms
}

func TestContractToolCallAndResume(t *testing.T) {
	path := contract(t)
	dir, ws := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(ws, "notes.txt"), []byte("the secret word is pelican\n"), 0o644)

	e := openEnv(t, dir, path)
	w, _ := e.AddWorkspace(ws)
	s, _ := e.NewSession(w.ID, claude.Kind, contractModel)
	ms := e.turn(t, s.ID, "Use the Read tool to read notes.txt, then reply with only the secret word.")
	var read *model.Message
	for i := range ms {
		if ms[i].Kind == model.ToolCall && ms[i].Tool.Name == "Read" {
			read = &ms[i]
		}
	}
	if read == nil || !read.Tool.Done || !strings.Contains(read.Tool.Output, "pelican") {
		t.Fatalf("no Read with the file's content: %+v", ms)
	}
	last := ms[len(ms)-1]
	if last.Kind != model.AgentReply || last.State != model.Done || !strings.Contains(strings.ToLower(last.Text), "pelican") {
		t.Fatalf("last message = %+v", last)
	}
	first, _ := e.Session(s.ID)
	if first.NativeID() == "" {
		t.Fatal("no native session recorded")
	}
	e.Close()

	// After a restart, the first message resumes the native session.
	e2 := openEnv(t, dir, path)
	defer e2.Close()
	ms = e2.turn(t, s.ID, "What was the secret word? Reply with only the word.")
	if last := ms[len(ms)-1]; !strings.Contains(strings.ToLower(last.Text), "pelican") {
		t.Errorf("resumed session forgot: %q", last.Text)
	}
	again, _ := e2.Session(s.ID)
	t.Logf("native sessions: %v", again.NativeIDs)
	if again.NativeIDs[0] != first.NativeID() {
		t.Errorf("native sessions = %v", again.NativeIDs)
	}
}

func TestContractInterrupt(t *testing.T) {
	path := contract(t)
	e := openEnv(t, t.TempDir(), path)
	defer e.Close()
	w, _ := e.AddWorkspace(t.TempDir())
	s, _ := e.NewSession(w.ID, claude.Kind, contractModel)
	if err := e.Send(s.ID, "Count from 1 to 400, one number per line, nothing else."); err != nil {
		t.Fatal(err)
	}
	e.until(t, "the reply to start", func() bool {
		ms, _ := e.Messages(s.ID)
		return len(ms) > 1 && len(ms[len(ms)-1].Text) > 20
	})
	if err := e.Stop(s.ID); err != nil {
		t.Fatal(err)
	}
	e.until(t, "the turn to end", func() bool { return !e.Status(s.ID).Running })
	ms, _ := e.Messages(s.ID)
	if r := ms[len(ms)-1]; r.State != model.Interrupted || strings.Contains(r.Text, "\n400") {
		t.Errorf("after stop: %v, %d bytes", r.State, len(r.Text))
	}
	if st := e.Status(s.ID); st.Error != "" {
		t.Errorf("stopping reported an error: %s", st.Error)
	}
	ms = e.turn(t, s.ID, "Reply with only: OK")
	if r := ms[len(ms)-1]; r.State != model.Done || !strings.Contains(r.Text, "OK") {
		t.Errorf("turn after stop = %+v", r)
	}
}
