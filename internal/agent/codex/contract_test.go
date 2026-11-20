package codex_test

// Contract tests with the real codex on this machine: off unless
// AIBO_CONTRACT=1, as they use the signed-in account. Their threads stay
// in Codex's own history (~/.codex), as aibo's threads do. Rerun them
// whenever Codex updates.
//
//	AIBO_CONTRACT=1 CGO_ENABLED=0 go test ./internal/agent/codex -run Contract -v

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func contract(t *testing.T) string {
	t.Helper()
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run against the real codex")
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		t.Skip("no codex on PATH")
	}
	return path
}

type env struct {
	*workbench.Workbench
	changes chan struct{}
}

func openEnv(t *testing.T, dir, path string) *env {
	t.Helper()
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: []agent.Agent{codex.New(path)}})
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
	guard := time.After(4 * time.Minute)
	for !cond() {
		select {
		case <-e.changes:
		case <-guard:
			t.Fatalf("timed out waiting for %s", what)
		}
	}
}

func (e *env) idle(t *testing.T, id string) []model.Message {
	t.Helper()
	e.until(t, "the turn to end", func() bool { return !e.Status(id).Running })
	if st := e.Status(id); st.Error != "" {
		t.Fatalf("Codex reported: %s", st.Error)
	}
	ms, _ := e.Messages(id)
	return ms
}

func lastReply(ms []model.Message) model.Message {
	for i := len(ms) - 1; i >= 0; i-- {
		if ms[i].Kind == model.AgentReply {
			return ms[i]
		}
	}
	return model.Message{}
}

func TestContractTwoThreadsCommandAndResume(t *testing.T) {
	path := contract(t)
	dir, ws := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(ws, "notes.txt"), []byte("the secret word is pelican\n"), 0o644)

	e := openEnv(t, dir, path)
	w, _ := e.AddWorkspace(ws)
	a, _ := e.NewSession(w.ID, codex.Kind, "")
	b, _ := e.NewSession(w.ID, codex.Kind, "")
	// Both turns run at once, in one app-server.
	if err := e.Send(a.ID, "Run `cat notes.txt` in the shell, then reply with only the secret word."); err != nil {
		t.Fatal(err)
	}
	if err := e.Send(b.ID, "Reply with only the word: walrus"); err != nil {
		t.Fatal(err)
	}
	ma, mb := e.idle(t, a.ID), e.idle(t, b.ID)
	var shell *model.Message
	for i := range ma {
		if ma[i].Kind == model.ToolCall && ma[i].Tool.Name == "shell" {
			shell = &ma[i]
		}
	}
	if shell == nil || !strings.Contains(shell.Tool.Output, "pelican") {
		t.Errorf("no shell call reading the file in a:\n%+v", ma)
	}
	if r := lastReply(ma); !strings.Contains(strings.ToLower(r.Text), "pelican") {
		t.Errorf("a replied %q", r.Text)
	}
	if r := lastReply(mb); !strings.Contains(strings.ToLower(r.Text), "walrus") || strings.Contains(strings.ToLower(r.Text), "pelican") {
		t.Errorf("b replied %q", r.Text)
	}
	for _, m := range mb {
		if m.Kind == model.ToolCall {
			t.Errorf("a's tool call went to b: %+v", m)
		}
	}
	first, _ := e.Session(a.ID)
	e.Close()

	// After a restart (a new app-server), the first message resumes the
	// thread.
	e2 := openEnv(t, dir, path)
	defer e2.Close()
	if err := e2.Send(a.ID, "What was the secret word? Reply with only the word."); err != nil {
		t.Fatal(err)
	}
	if r := lastReply(e2.idle(t, a.ID)); !strings.Contains(strings.ToLower(r.Text), "pelican") {
		t.Errorf("resumed thread forgot: %q", r.Text)
	}
	again, _ := e2.Session(a.ID)
	if again.NativeID() != first.NativeID() {
		t.Errorf("native sessions = %v, want %s still", again.NativeIDs, first.NativeID())
	}
}

func TestContractInterrupt(t *testing.T) {
	path := contract(t)
	e := openEnv(t, t.TempDir(), path)
	defer e.Close()
	w, _ := e.AddWorkspace(t.TempDir())
	s, _ := e.NewSession(w.ID, codex.Kind, "")
	if err := e.Send(s.ID, "Count from 1 to 400, one number per line, nothing else."); err != nil {
		t.Fatal(err)
	}
	e.until(t, "the reply to start", func() bool {
		ms, _ := e.Messages(s.ID)
		return len(lastReply(ms).Text) > 20
	})
	if err := e.Stop(s.ID); err != nil {
		t.Fatal(err)
	}
	ms := e.idle(t, s.ID)
	if r := lastReply(ms); r.State != model.Interrupted {
		t.Errorf("after stop: %v", r.State)
	}
	if err := e.Send(s.ID, "Reply with only: OK"); err != nil {
		t.Fatal(err)
	}
	if r := lastReply(e.idle(t, s.ID)); r.State != model.Done || !strings.Contains(r.Text, "OK") {
		t.Errorf("turn after stop = %+v", r)
	}
}
