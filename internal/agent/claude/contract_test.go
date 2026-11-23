package claude_test

// Contract tests with the real claude on this machine: off unless
// AIBO_CONTRACT=1, as they cost money and need a signed-in Claude Code.
// Rerun them whenever Claude Code updates.
//
//	AIBO_CONTRACT=1 CGO_ENABLED=0 go test ./internal/agent/claude -run Contract -v

import (
	"context"
	"errors"
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
	if st := e.Status(id); st.Error != nil {
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
	if st := e.Status(s.ID); st.Error != nil {
		t.Errorf("stopping reported an error: %s", st.Error)
	}
	ms = e.turn(t, s.ID, "Reply with only: OK")
	if r := ms[len(ms)-1]; r.State != model.Done || !strings.Contains(r.Text, "OK") {
		t.Errorf("turn after stop = %+v", r)
	}
}

func TestContractResumeFailure(t *testing.T) {
	path := contract(t)
	_, err := claude.New(path).Start(context.Background(), agent.StartOptions{Workspace: t.TempDir(), Model: contractModel, ResumeID: "00000000-0000-4000-8000-000000000000"})
	if !errors.Is(err, agent.ErrResumeFailed) || !strings.Contains(err.Error(), "No conversation found") {
		t.Errorf("resuming a lost session: %v", err)
	}
	t.Logf("error: %v", err)
}

// The model and the effort change between turns without a new process,
// and hold when the session resumes: Claude Code forgets the effort then,
// which goes again on the command line.
func TestContractModelAndEffort(t *testing.T) {
	path := contract(t)
	dir := t.TempDir()
	e := openEnv(t, dir, path)
	w, _ := e.AddWorkspace(t.TempDir())
	s, _ := e.NewSession(w.ID, claude.Kind, contractModel)
	if err := e.SetModel(s.ID, contractModel, "low"); err != nil {
		t.Fatal(err)
	}
	e.turn(t, s.ID, "Reply with just OK.")
	if st := e.Status(s.ID); !strings.Contains(st.Model, "haiku") || st.Effort != "low" {
		t.Errorf("started on %q %q", st.Model, st.Effort)
	}
	first, _ := e.Session(s.ID)
	if err := e.SetModel(s.ID, "sonnet", "high"); err != nil {
		t.Fatal(err)
	}
	e.until(t, "Claude Code to report", func() bool {
		st := e.Status(s.ID)
		return strings.Contains(st.Model, "sonnet") && st.Effort == "high"
	})
	e.turn(t, s.ID, "Reply with just OK again.")
	again, _ := e.Session(s.ID)
	if len(again.NativeIDs) != len(first.NativeIDs) {
		t.Errorf("a new native session: %v → %v", first.NativeIDs, again.NativeIDs)
	}
	e.Close()

	e2 := openEnv(t, dir, path)
	defer e2.Close()
	e2.turn(t, s.ID, "Reply with just OK once more.")
	if st := e2.Status(s.ID); !strings.Contains(st.Model, "sonnet") || st.Effort != "high" {
		t.Errorf("resumed on %q %q", st.Model, st.Effort)
	}
}

// A file mentioned reaches Claude Code as @path, which it reads by itself.
func TestContractFileMention(t *testing.T) {
	path := contract(t)
	ws := t.TempDir()
	os.WriteFile(filepath.Join(ws, "my notes.txt"), []byte("the secret word is pelican\n"), 0o644)
	e := openEnv(t, t.TempDir(), path)
	defer e.Close()
	w, _ := e.AddWorkspace(ws)
	s, _ := e.NewSession(w.ID, claude.Kind, contractModel)
	m := model.Mention{Path: filepath.Join(ws, "my notes.txt"), WorkspaceID: w.ID}
	if err := e.SendWithFiles(s.ID, "What is the secret word in the file I mention? Do not use any tools. Reply with only the word.", []model.Mention{m}); err != nil {
		t.Fatal(err)
	}
	e.until(t, "the turn to end", func() bool { return !e.Status(s.ID).Running })
	ms, _ := e.Messages(s.ID)
	last := ms[len(ms)-1]
	if !strings.Contains(strings.ToLower(last.Text), "pelican") {
		t.Errorf("replied %q", last.Text)
	}
	for _, x := range ms {
		if x.Kind == model.ToolCall {
			t.Errorf("it used %s", x.Tool.Name)
		}
	}
}
