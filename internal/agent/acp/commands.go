package acp

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// An ACP Agent's commands (.scratch/agent-extensibility/issues/06): it
// tells them with available_commands_update after a session starts, and
// again as they change, and runs one sent as "/name args" at the start of
// a prompt. Which commands work in a client is the Agent's side to say, as
// its ACP adapter leaves out the rest, so all it tells are offered, for
// the Agent to run (ADR 0009).

// availableCommand is one command as ACP tells it.
type availableCommand struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Input       *struct {
		Hint string `json:"hint"`
	} `json:"input"`
}

// offered are the commands an available_commands_update tells, all for
// the Agent to run; one without a name, or named twice, is left out.
func offered(raw json.RawMessage) ([]agent.Command, bool) {
	var u struct {
		AvailableCommands []availableCommand `json:"availableCommands"`
	}
	if json.Unmarshal(raw, &u) != nil {
		return nil, false
	}
	out := []agent.Command{}
	seen := map[string]bool{}
	for _, c := range u.AvailableCommands {
		if c.Name == "" || seen[c.Name] {
			continue
		}
		seen[c.Name] = true
		cmd := agent.Command{Name: c.Name, Description: c.Description}
		if c.Input != nil {
			cmd.ArgumentHint = c.Input.Hint
		}
		out = append(out, cmd)
	}
	return out, true
}

// Commands: an ACP Agent tells them only from a session.
func (a *Agent) Commands(context.Context, string) ([]agent.Command, error) {
	return nil, agent.ErrCommandsFromSession
}

// noCommandsAfter is how long a session waits for the Agent to tell its
// commands before it says it has none: ACP lets an Agent tell none, and a
// list it tells later replaces the empty one.
var noCommandsAfter = 5 * time.Second

// commandsTold notes that the session told its commands, at least once:
// the empty list of awaitCommands then never follows the Agent's own.
type commandsTold struct {
	mu   sync.Mutex
	told bool
	ch   chan struct{}
}

// tell reports cmds; a fallback, none, only while none were told.
func (c *commandsTold) tell(s *session, cmds []agent.Command, fallback bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if fallback && c.told {
		return
	}
	if !c.told {
		c.told = true
		if c.ch != nil {
			close(c.ch)
		}
	}
	s.emit(agent.CommandsChanged{Commands: cmds})
}

// tellCommands reports the commands of an available_commands_update.
func (s *session) tellCommands(raw json.RawMessage) {
	cmds, ok := offered(raw)
	if !ok {
		return
	}
	s.commands.tell(s, cmds, false)
}

// awaitCommands reports no commands unless the Agent tells some soon
// after the session started.
func (s *session) awaitCommands() {
	// Read here, not in the goroutine: a test sets it, and restores it
	// without waiting for a goroutine that already returned.
	wait := noCommandsAfter
	go func() {
		select {
		case <-s.commands.ch:
		case <-s.stopping:
		case <-time.After(wait):
			s.commands.tell(s, []agent.Command{}, true)
		}
	}()
}

// commandText is how an ACP Agent takes a turn invoking a command: at the
// start of the prompt's text, what follows after it.
func commandText(t agent.Turn) string {
	if t.Command == nil {
		return t.Text
	}
	if t.Text == "" {
		return "/" + t.Command.Name
	}
	return "/" + t.Command.Name + " " + t.Text
}
