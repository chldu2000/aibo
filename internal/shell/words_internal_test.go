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

// "/word" that was not sent says why, naming the Agent and the word.
func TestSaySlashCommand(t *testing.T) {
	s := &Shell{}
	for _, c := range []struct {
		reason workbench.SlashReason
		want   string
	}{
		{workbench.NotACommand, locales.ErrNotACommand("clear", "Codex")},
		{workbench.CommandsUnknown, locales.ErrCommandsUnknown("Codex", "clear")},
		{workbench.NoCommands, locales.ErrNoCommands("Codex", "clear")},
	} {
		err := fmt.Errorf("send: %w", &workbench.SlashCommandError{Agent: "Codex", Command: "clear", Reason: c.reason})
		if got := s.say(err); got != c.want {
			t.Errorf("reason %v: said %q", c.reason, got)
		}
	}
	if got := locales.ErrNotACommand("clear", "Codex"); got != "“/clear”不是 Codex 的可用命令。想原样发给模型，请在开头加一个空格。" {
		t.Errorf("in Chinese: %q", got)
	}
}
