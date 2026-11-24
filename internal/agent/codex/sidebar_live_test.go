package codex_test

import (
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestContractSidebarCommandStream(t *testing.T) {
	path := contract(t)
	e := openEnv(t, t.TempDir(), path)
	defer e.Close()
	ws, err := e.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sess, err := e.NewSession(ws.ID, codex.Kind, "")
	if err != nil {
		t.Fatal(err)
	}
	var streamed atomic.Bool
	if err := e.SetMode(sess.ID, "read-only"); err != nil {
		t.Fatal(err)
	}
	off := e.Subscribe(func(c workbench.Change) {
		if c.SessionID != sess.ID || c.Message == nil {
			return
		}
		tool := c.Message.Tool
		if tool != nil && !tool.Done && strings.Contains(tool.Output, "AIBO_FIRST") {
			streamed.Store(true)
		}
	})
	defer off()
	if err := e.Send(sess.ID, "Controlled desktop UI acceptance test. Please actually call the shell once to print AIBO_FIRST, wait 3 seconds, then print AIBO_LAST. In PowerShell run Write-Output 'AIBO_FIRST'; Start-Sleep -Seconds 3; Write-Output 'AIBO_LAST'. On Unix use printf and sleep. Wait for command completion. Do not read files or use any other tools. Reply DONE."); err != nil {
		t.Fatal(err)
	}
	msgs := e.idle(t, sess.ID)
	if !streamed.Load() {
		for _, m := range msgs {
			if m.Tool != nil {
				t.Logf("tool %s output %.240q", m.Tool.Name, m.Tool.Output)
			} else if m.Text != "" {
				t.Logf("message %.240q", m.Text)
			}
		}
		t.Fatal("no output received before completion")
	}
	for _, a := range workbench.Activities(msgs, workbench.Commands) {
		out := a.Message.Tool.Output
		if strings.Count(out, "AIBO_FIRST") == 1 && strings.Count(out, "AIBO_LAST") == 1 {
			return
		}
	}
	t.Fatal("completion did not reconcile the streamed output")
}
