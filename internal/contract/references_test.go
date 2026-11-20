// Package contract holds contract tests across the real Agents on this
// machine: off unless AIBO_CONTRACT=1. Rerun them whenever an Agent
// updates.
//
//	AIBO_CONTRACT=1 CGO_ENABLED=0 go test ./internal/contract -v
package contract

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
)

func agents(t *testing.T) []agent.Agent {
	t.Helper()
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run against the real Agents")
	}
	cl, err1 := exec.LookPath("claude")
	cx, err2 := exec.LookPath("codex")
	if err1 != nil || err2 != nil {
		t.Skip("needs both claude and codex on PATH")
	}
	// The source session is the fake's: what it said is the secret.
	src := fake.New(func(ctx context.Context, _ agent.StartOptions, _ agent.Turn, emit func(agent.Event)) {
		emit(agent.ReplyDone{ReplyID: "r", Text: "定了：暗号是 albatross-42。"})
	})
	return []agent.Agent{src, claude.New(cl), codex.New(cx)}
}

func TestContractRealAgentsReadReferences(t *testing.T) {
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
	idle := func(id string) []model.Message {
		t.Helper()
		guard := time.After(4 * time.Minute)
		for w.Status(id).Running {
			select {
			case <-changes:
			case <-guard:
				t.Fatal("the turn never ended")
			}
		}
		if e := w.Status(id).Error; e != "" {
			t.Fatalf("error: %s", e)
		}
		ms, _ := w.Messages(id)
		return ms
	}
	ws, _ := w.AddWorkspace(t.TempDir())
	src, _ := w.NewSession(ws.ID, fake.Kind, "")
	w.Send(src.ID, "我们定一个暗号")
	idle(src.ID)

	ask := "Use the aibo tools to read the reference I gave you, then reply in exactly two lines: " +
		"first the secret code it contains, then the exact name of the tool you called to read it."
	for _, c := range []struct {
		kind  agent.Kind
		model string
	}{{claude.Kind, "haiku"}, {codex.Kind, ""}} {
		t.Run(string(c.kind), func(t *testing.T) {
			tgt, _ := w.NewSession(ws.ID, c.kind, c.model)
			r, err := w.ReferenceSession(src.ID, tgt.ID)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("brief names the tool: %s", firstLine(r.Brief, "可用工具"))
			if err := w.Send(tgt.ID, ask); err != nil {
				t.Fatal(err)
			}
			ms := idle(tgt.ID)
			reply := ""
			for _, m := range ms {
				if m.Kind == model.ToolCall {
					t.Logf("tool call: %s %s → %.80q", m.Tool.Name, m.Tool.Input, m.Tool.Output)
				}
				if m.Kind == model.AgentReply {
					reply = m.Text
				}
			}
			t.Logf("reply: %q", reply)
			if !strings.Contains(reply, "albatross-42") {
				t.Errorf("the Agent did not read the reference: %q", reply)
			}
			got, _ := w.Reference(r.ID)
			if len(got.Reads) == 0 {
				t.Error("no read recorded on the workbench's side")
			}
		})
	}
}

func firstLine(s, with string) string {
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, with) {
			return l
		}
	}
	return ""
}

// Two Codex threads share one app-server; each reaches the workbench's
// MCP server with its own token, so neither can read what the other was
// given.
func TestContractCodexThreadsAreIsolated(t *testing.T) {
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
	idle := func(id string) []model.Message {
		t.Helper()
		guard := time.After(4 * time.Minute)
		for w.Status(id).Running {
			select {
			case <-changes:
			case <-guard:
				t.Fatal("the turn never ended")
			}
		}
		ms, _ := w.Messages(id)
		return ms
	}
	ws, _ := w.AddWorkspace(t.TempDir())
	src, _ := w.NewSession(ws.ID, fake.Kind, "")
	w.Send(src.ID, "我们定一个暗号")
	idle(src.ID)
	a, _ := w.NewSession(ws.ID, codex.Kind, "")
	b, _ := w.NewSession(ws.ID, codex.Kind, "")
	ra, _ := w.ReferenceSession(src.ID, a.ID)
	w.Send(a.ID, "Reply with only: ready") // a's thread starts, with its token
	idle(a.ID)

	w.Send(b.ID, "Call the mcp__aibo__read_reference tool with ref_id \""+ra.ID+"\" and reply with exactly what it returned, or the error it gave.")
	var call *model.Message
	for _, m := range idle(b.ID) {
		if m.Kind == model.ToolCall && strings.HasSuffix(m.Tool.Name, "read_reference") {
			call = &m
		}
	}
	if call == nil {
		t.Fatal("b did not call read_reference")
	}
	t.Logf("b's call: %s → %q", call.Tool.Input, call.Tool.Output)
	if strings.Contains(call.Tool.Output, "albatross-42") || !strings.Contains(call.Tool.Output, "本会话没有") {
		t.Errorf("b read a's reference: %q", call.Tool.Output)
	}
	if got, _ := w.Reference(ra.ID); len(got.Reads) != 0 {
		t.Errorf("a's reference was read: %+v", got.Reads)
	}
}
