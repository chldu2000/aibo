package shell

import (
	"fmt"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
)

// A session that did not start because its Agent is signed out says so,
// rather than that the Agent did not start.
func TestSaySignedOutAtStart(t *testing.T) {
	err := fmt.Errorf("%w: session/new: %w: ACP -32000: Authentication required", agent.ErrStartFailed, agent.ErrNotLoggedIn)
	s := &Shell{}
	if got := s.say(err); got != locales.ErrNotLoggedIn() {
		t.Errorf("said %q", got)
	}
	if got, want := s.say(&workbench.Failure{Step: workbench.StepStart, Err: err}), withDetail(locales.FailStart(), locales.ErrNotLoggedIn()); got != want {
		t.Errorf("failure said %q, want %q", got, want)
	}
}
