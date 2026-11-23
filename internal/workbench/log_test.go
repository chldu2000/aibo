package workbench_test

import (
	"bytes"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/workbench"
)

// syncBuffer is a log written from several goroutines.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// A turn's start, the Agent's retries and errors, and its end go to the
// diagnostic log, by session; what the user and the Agent said does not.
func TestDiagnosticLog(t *testing.T) {
	var buf syncBuffer
	sc := newScript()
	b := openWith(t, t.TempDir(), sc.respond, workbench.Options{Log: slog.New(slog.NewTextHandler(&buf, nil))})
	defer b.Close()
	_, s := newSession(t, b)
	if err := b.Send(s.ID, "the secret word is pelican"); err != nil {
		t.Fatal(err)
	}
	sc.emit(agent.Retrying{Attempt: 1, Max: 10, Message: "529 overloaded"},
		agent.ReplyDelta{ReplyID: "r", Text: "walrus"}, agent.ReplyDone{ReplyID: "r"},
		agent.Failed{Message: "stream disconnected"})
	sc.endTurn()
	b.idle(t, s.ID)

	log := buf.String()
	for _, want := range []string{
		"msg=\"turn started\" session=" + s.ID,
		"msg=\"native session started\" session=" + s.ID,
		"msg=\"agent retrying\" session=" + s.ID,
		"529 overloaded",
		"msg=\"agent failed\" session=" + s.ID,
		"stream disconnected",
		"msg=\"turn ended\" session=" + s.ID,
	} {
		if !strings.Contains(log, want) {
			t.Errorf("the log lacks %q:\n%s", want, log)
		}
	}
	for _, secret := range []string{"pelican", "walrus"} {
		if strings.Contains(log, secret) {
			t.Errorf("the log holds %q:\n%s", secret, log)
		}
	}
}
