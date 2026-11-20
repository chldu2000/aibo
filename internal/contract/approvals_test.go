package contract

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

// Each Agent asks before writing; aibo answers with the Agent's own
// options: the first write allowed once, the second denied with a note.
func TestContractApprovals(t *testing.T) {
	as := agents(t)
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: as})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	changes := make(chan struct{}, 4096)
	w.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	wait := func(cond func() bool) {
		t.Helper()
		guard := time.After(4 * time.Minute)
		for !cond() {
			select {
			case <-changes:
			case <-guard:
				t.Fatal("timed out")
			}
		}
	}
	pending := func(id string) *model.Approval {
		ms, _ := w.Messages(id)
		for _, m := range ms {
			if m.Tool != nil && m.Tool.Approval.Pending() {
				return m.Tool.Approval
			}
		}
		if l := w.LooseApprovals(id); len(l) > 0 {
			return &l[0]
		}
		return nil
	}
	option := func(a *model.Approval, kind agent.OptionKind) string {
		for _, o := range a.Options {
			if o.Kind == kind {
				return o.ID
			}
		}
		t.Fatalf("no %s option: %+v", kind, a.Options)
		return ""
	}

	for _, c := range []struct {
		kind  agent.Kind
		model string
		// dir is where the files go: Codex writes its workspace (and
		// $TMPDIR) without asking, so it is asked to write outside.
		outside bool
	}{{claude.Kind, "haiku", false}, {codex.Kind, "", true}} {
		t.Run(string(c.kind), func(t *testing.T) {
			ws := t.TempDir()
			dir := ws
			if c.outside {
				dir = outsideDir(t)
			}
			first, second := filepath.Join(dir, "first.txt"), filepath.Join(dir, "second.txt")
			wsp, _ := w.AddWorkspace(ws)
			s, _ := w.NewSession(wsp.ID, c.kind, c.model)
			err := w.Send(s.ID, "Run these two shell commands, one tool call each, in order: `touch "+first+"` and then `touch "+second+
				"`. If one is denied, do not retry it; after both, reply with one sentence saying what happened.")
			if err != nil {
				t.Fatal(err)
			}
			wait(func() bool { return pending(s.ID) != nil || !w.Status(s.ID).Running })
			a := pending(s.ID)
			if a == nil {
				ms, _ := w.Messages(s.ID)
				for _, m := range ms {
					if m.Tool != nil {
						t.Logf("tool: %s %s → %q", m.Tool.Name, m.Tool.Input, m.Tool.Output)
					} else {
						t.Logf("%s: %q", m.Kind, m.Text)
					}
				}
				t.Fatalf("no approval was asked; error: %q", w.Status(s.ID).Error)
			}
			t.Logf("first request: %s %q outside=%v options=%v", a.Title, a.Command, a.Outside, a.Options)
			if a.Outside != c.outside && a.Command == "" {
				t.Errorf("outside = %v", a.Outside)
			}
			if err := w.Approve(s.ID, a.ID, option(a, agent.AllowOnce), ""); err != nil {
				t.Fatal(err)
			}
			wait(func() bool { p := pending(s.ID); return p != nil && p.ID != a.ID || !w.Status(s.ID).Running })
			if b := pending(s.ID); b != nil {
				t.Logf("second request: %s %q", b.Title, b.Command)
				if err := w.Approve(s.ID, b.ID, option(b, agent.Deny), "不需要第二个文件"); err != nil {
					t.Fatal(err)
				}
			} else {
				t.Error("no second request")
			}
			wait(func() bool { return !w.Status(s.ID).Running })
			if _, err := os.Stat(first); err != nil {
				t.Errorf("the allowed command did not run: %v", err)
			}
			if _, err := os.Stat(second); err == nil {
				t.Error("the denied command ran")
			}
			ms, _ := w.Messages(s.ID)
			var answers []string
			for _, m := range ms {
				if m.Tool != nil && m.Tool.Approval != nil && m.Tool.Approval.Answer != nil {
					answers = append(answers, string(m.Tool.Approval.Answer.Kind)+":"+m.Tool.Approval.Note)
				}
				if m.Kind == model.AgentReply {
					t.Logf("reply: %q", m.Text)
				}
			}
			if strings.Join(answers, ",") != "allow_once:,deny:不需要第二个文件" {
				t.Errorf("answers recorded = %q", answers)
			}
		})
	}
}
