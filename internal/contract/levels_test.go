package contract

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

type env struct {
	*workbench.Workbench
	t       *testing.T
	changes chan struct{}
}

func openEnv(t *testing.T, dir string, as []agent.Agent) *env {
	t.Helper()
	w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: as})
	if err != nil {
		t.Fatal(err)
	}
	e := &env{Workbench: w, t: t, changes: make(chan struct{}, 4096)}
	w.Subscribe(func(workbench.Change) {
		select {
		case e.changes <- struct{}{}:
		default:
		}
	})
	return e
}

func (e *env) until(cond func() bool) {
	e.t.Helper()
	guard := time.After(4 * time.Minute)
	for !cond() {
		select {
		case <-e.changes:
		case <-guard:
			e.t.Fatal("timed out")
		}
	}
}

func (e *env) pending(id string) *model.Approval {
	ms, _ := e.Messages(id)
	for _, m := range ms {
		if m.Tool != nil && m.Tool.Approval.Pending() {
			return m.Tool.Approval
		}
	}
	if l := e.LooseApprovals(id); len(l) > 0 {
		return &l[0]
	}
	return nil
}

// run sends text and answers every approval with answer; it returns how
// many it was asked.
func (e *env) run(id, text string, answer agent.OptionKind) int {
	e.t.Helper()
	if err := e.Send(id, text); err != nil {
		e.t.Fatal(err)
	}
	asked := 0
	for {
		e.until(func() bool { return e.pending(id) != nil || !e.Status(id).Running })
		a := e.pending(id)
		if a == nil {
			return asked
		}
		asked++
		for _, o := range a.Options {
			if o.Kind == answer {
				e.Approve(id, a.ID, o.ID, "")
			}
		}
	}
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

// outsideDir is a directory Codex's workspace-write sandbox cannot write
// without asking: not the workspace, and not $TMPDIR or /tmp, which it
// can.
func outsideDir(t *testing.T) string {
	t.Helper()
	home, _ := os.UserHomeDir()
	dir, err := os.MkdirTemp(home, ".aibo-contract-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

func TestContractModesAndRules(t *testing.T) {
	as := agents(t)
	touch := func(p string) string {
		return "Run exactly this shell command with your shell tool, nothing else: `touch " + p + "`. Then reply DONE."
	}
	t.Run("claude", func(t *testing.T) {
		dir, ws := t.TempDir(), t.TempDir()
		e := openEnv(t, dir, as)
		w, _ := e.AddWorkspace(ws)
		s, _ := e.NewSession(w.ID, claude.Kind, "haiku")

		e.SetMode(s.ID, "acceptEdits")
		write := func(name string) string {
			return "Use the Write tool to create " + filepath.Join(ws, name) + " containing hi. Then reply DONE."
		}
		if n := e.run(s.ID, write("a.txt"), agent.Deny); n != 0 || !exists(filepath.Join(ws, "a.txt")) {
			t.Errorf("accepting edits: asked %d times, wrote %v", n, exists(filepath.Join(ws, "a.txt")))
		}
		// Back to asking, in the running session.
		e.SetMode(s.ID, "default")
		if n := e.run(s.ID, write("b.txt"), agent.Deny); n == 0 || exists(filepath.Join(ws, "b.txt")) {
			t.Errorf("asking always: asked %d times, wrote %v", n, exists(filepath.Join(ws, "b.txt")))
		}
		// Allowed for the session, then the workbench restarts.
		cmd := touch(filepath.Join(ws, "r.txt"))
		if n := e.run(s.ID, cmd, agent.AllowSession); n == 0 {
			t.Error("the command did not ask")
		}
		got, _ := e.Session(s.ID)
		t.Logf("rules: %+v", got.Rules)
		os.Remove(filepath.Join(ws, "r.txt"))
		e.Close()
		e2 := openEnv(t, dir, as)
		defer e2.Close()
		if n := e2.run(s.ID, cmd, agent.Deny); n != 0 || !exists(filepath.Join(ws, "r.txt")) {
			t.Errorf("after restart: asked %d times, ran %v", n, exists(filepath.Join(ws, "r.txt")))
		}
	})
	t.Run("codex", func(t *testing.T) {
		dir, ws, out := t.TempDir(), t.TempDir(), outsideDir(t)
		e := openEnv(t, dir, as)
		w, _ := e.AddWorkspace(ws)
		s, _ := e.NewSession(w.ID, codex.Kind, "")

		e.SetMode(s.ID, "full-access")
		if n := e.run(s.ID, touch(filepath.Join(out, "a.txt")), agent.Deny); n != 0 || !exists(filepath.Join(out, "a.txt")) {
			t.Errorf("full access: asked %d times, wrote %v", n, exists(filepath.Join(out, "a.txt")))
		}
		// Codex says it is in the preset (thread/settings/updated).
		if m := e.Status(s.ID).Mode; m != "full-access" {
			t.Errorf("reported %q", m)
		}
		e.SetMode(s.ID, "ask-for-approval")
		if n := e.run(s.ID, touch(filepath.Join(out, "b.txt")), agent.Deny); n == 0 || exists(filepath.Join(out, "b.txt")) {
			t.Errorf("asking for approval: asked %d times, wrote %v", n, exists(filepath.Join(out, "b.txt")))
		}
		if m := e.Status(s.ID).Mode; m != "ask-for-approval" {
			t.Errorf("reported %q", m)
		}
		cmd := touch(filepath.Join(out, "r.txt"))
		if n := e.run(s.ID, cmd, agent.AllowSession); n == 0 {
			t.Error("the command did not ask")
		}
		got, _ := e.Session(s.ID)
		t.Logf("rules: %+v", got.Rules)
		os.Remove(filepath.Join(out, "r.txt"))
		e.Close()
		e2 := openEnv(t, dir, as)
		defer e2.Close()
		if n := e2.run(s.ID, cmd, agent.Deny); n != 0 || !exists(filepath.Join(out, "r.txt")) {
			t.Errorf("after restart: asked %d times, ran %v", n, exists(filepath.Join(out, "r.txt")))
		}
	})
}

// Plan mode: the plan comes as an approval; approved, Claude Code leaves
// plan mode, and the session follows.
func TestContractClaudePlanMode(t *testing.T) {
	as := agents(t)
	ws := t.TempDir()
	e := openEnv(t, t.TempDir(), as)
	defer e.Close()
	w, _ := e.AddWorkspace(ws)
	s, _ := e.NewSession(w.ID, claude.Kind, "haiku")
	if err := e.SetMode(s.ID, "plan"); err != nil {
		t.Fatal(err)
	}
	if err := e.Send(s.ID, "Make a plan to create a.txt containing hi. It is one step: present it right away with ExitPlanMode, without reading anything."); err != nil {
		t.Fatal(err)
	}
	e.until(func() bool { return e.pending(s.ID) != nil || !e.Status(s.ID).Running })
	a := e.pending(s.ID)
	if a == nil || a.Plan == "" {
		t.Fatalf("no plan to approve: %+v", a)
	}
	for _, o := range a.Options {
		if o.Kind == agent.AllowOnce {
			e.Approve(s.ID, a.ID, o.ID, "")
		}
	}
	// Then it acts: answer what it asks, and see the mode it is in after.
	for {
		e.until(func() bool { return e.pending(s.ID) != nil || !e.Status(s.ID).Running })
		p := e.pending(s.ID)
		if p == nil {
			break
		}
		for _, o := range p.Options {
			if o.Kind == agent.AllowOnce {
				e.Approve(s.ID, p.ID, o.ID, "")
			}
		}
	}
	e.run(s.ID, "Reply with just OK.", agent.Deny)
	got, _ := e.Session(s.ID)
	t.Logf("after the plan: %q, reported %q", got.Mode, e.Status(s.ID).Mode)
	if got.Mode == "plan" {
		t.Error("still in plan mode after the plan was approved")
	}
}
