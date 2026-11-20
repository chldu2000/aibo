package workbench_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestSignedOutAgent(t *testing.T) {
	sc := newScript()
	notReady := errors.New("Codex 未登录")
	var ready error
	signedOut := make(chan agent.Kind, 4)
	b := openWith(t, t.TempDir(), sc.respond, workbench.Options{
		Ready:         func(agent.Kind) error { return ready },
		OnNotLoggedIn: func(k agent.Kind) { signedOut <- k },
	})
	defer b.Close()
	ws, src := newSession(t, b)
	converse(t, b, sc, src.ID, "方案", "定了")
	s, _ := b.NewSession(ws.ID, fake.Kind, "")

	// Not ready: nothing sent, nothing recorded.
	ready = notReady
	if err := b.Send(s.ID, "你好"); !errors.Is(err, notReady) {
		t.Errorf("send: %v", err)
	}
	if err := b.Compact(src.ID); !errors.Is(err, notReady) {
		t.Errorf("compact: %v", err)
	}
	if n := len(b.messages(t, s.ID)); n != 0 {
		t.Errorf("%d messages recorded", n)
	}
	ready = nil

	// The Agent finds itself signed out in the turn.
	b.ReferenceSession(src.ID, s.ID)
	b.Send(s.ID, "按方案做")
	sc.emit(agent.NotLoggedIn{}, agent.Failed{Message: "未登录"})
	sc.endTurn()
	b.idle(t, s.ID)
	if st := b.Status(s.ID); !st.NeedsLogin || st.Error != "未登录" {
		t.Errorf("status = %+v", st)
	}
	if k := <-signedOut; k != fake.Kind {
		t.Errorf("told of %q", k)
	}

	// After signing in, the same message goes again, not recorded twice.
	if err := b.Retry(s.ID); err != nil {
		t.Fatal(err)
	}
	sc.emit(agent.ReplyDone{ReplyID: "r", Text: "好的"})
	sc.endTurn()
	b.idle(t, s.ID)
	turns, _ := sc.received()
	again := turns[len(turns)-1].Text
	if !strings.HasPrefix(again, "<aibo-reference") || !strings.HasSuffix(again, "按方案做") {
		t.Errorf("retried with %q", again)
	}
	ms := b.messages(t, s.ID)
	if len(ms) != 2 || ms[0].Text != "按方案做" || ms[1].Text != "好的" {
		t.Errorf("messages = %+v", ms)
	}
	if st := b.Status(s.ID); st.NeedsLogin || st.Error != "" {
		t.Errorf("after retrying: %+v", st)
	}
	empty, _ := b.NewSession(ws.ID, fake.Kind, "")
	if err := b.Retry(empty.ID); !errors.Is(err, workbench.ErrNothingToRetry) {
		t.Errorf("retrying nothing: %v", err)
	}
}
