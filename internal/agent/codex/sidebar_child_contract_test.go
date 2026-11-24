package codex_test

import (
	"context"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/workbench"
	"testing"
	"time"
)

func TestContractSidebarChildHistoryAfterRestart(t *testing.T) {
	path := contract(t)
	dir := t.TempDir()
	e := openEnv(t, dir, path)
	ws, err := e.AddWorkspace(t.TempDir())
	if err != nil {
		e.Close()
		t.Fatal(err)
	}
	sess, err := e.NewSession(ws.ID, codex.Kind, "")
	if err != nil {
		e.Close()
		t.Fatal(err)
	}
	if err = e.SetMode(sess.ID, "read-only"); err != nil {
		e.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { e.Close() })
	if err = e.Send(sess.ID, "Use spawn_agent for TWO separate children in parallel. Ask the first child to reply exactly AIBO_CHILD_ONE and the second to reply exactly AIBO_CHILD_TWO. Both must use no tools or files. Wait for both, then reply DONE."); err != nil {
		t.Fatal(err)
	}
	msgs := e.idle(t, sess.ID)
	if err := e.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := openEnv(t, dir, path)
	defer reopened.Close()
	seen := map[string]bool{}
	for _, a := range workbench.Activities(msgs, workbench.Delegations) {
		if a.Message.Tool.ChildThread == "" {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		page, err := reopened.ChildHistory(ctx, sess.ID, a.ID, "")
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range page.Entries {
			if entry.Kind == "agentMessage" {
				seen[entry.Text] = true
			}
		}
	}
	if !seen["AIBO_CHILD_ONE"] || !seen["AIBO_CHILD_TWO"] {
		t.Fatalf("unexpected child replies: %v", seen)
	}
	if reopened.Status(sess.ID).Connected {
		t.Fatal("history read reconnected the parent session")
	}
}
