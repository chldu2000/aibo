package agent

import (
	"context"
	"encoding/json"
	"errors"
)

// Command is one of an Agent's own commands (GLOSSARY: Agent command): a
// built-in, a command the user or the project defined, or a skill, as the
// Agent reports it. The user invokes it with "/", and the adapter turns
// that into its Agent's own way (ADR 0008).
type Command struct {
	// Name is the command's own name, without "/"; Aliases are other
	// names it answers to.
	Name    string
	Aliases []string `json:",omitempty"`
	// Description is the Agent's one line on what it does; ArgumentHint
	// what to write after it, as "<file>"; either may be empty.
	Description  string
	ArgumentHint string `json:",omitempty"`
	// Source is where it comes from, only when the Agent says so, in its
	// own words, as Codex's "repo" or "user".
	Source string `json:",omitempty"`
	// Builtin is set on the Agent's own built-in commands.
	Builtin bool `json:",omitempty"`
	// Handling is how the workbench carries it out (ADR 0007).
	Handling Handling `json:",omitempty"`
	// Data is the adapter's own, as a skill's path, which the workbench
	// only keeps.
	Data json.RawMessage `json:",omitempty"`
}

// Handling is how the workbench carries out an Agent command. An adapter
// does not report the commands it rules out.
type Handling string

const (
	// ByAgent: the Agent runs it, as a turn.
	ByAgent Handling = ""
	// The workbench's own controls carry these out instead, as the Agent
	// would not report what they changed: the model (SetModel), the
	// reasoning effort (SetModel), compacting (Compact), the session's
	// title, and the permission mode (SetMode).
	ByModel   Handling = "model"
	ByEffort  Handling = "effort"
	ByCompact Handling = "compact"
	ByRename  Handling = "rename"
	ByMode    Handling = "mode"
	// ByReset: it clears the Agent's context, as a turn that reports
	// ContextReset.
	ByReset Handling = "reset"
)

// Answers reports whether the command is called name, by its name or an
// alias.
func (c Command) Answers(name string) bool {
	if c.Name == name {
		return true
	}
	for _, a := range c.Aliases {
		if a == name {
			return true
		}
	}
	return false
}

// ErrCommandsFromSession is what CommandLister.Commands returns for an
// Agent that tells its commands only from a native session: it reports
// them (CommandsChanged) as the session starts.
var ErrCommandsFromSession = errors.New("the Agent tells its commands only from a session")

// CommandLister is an Agent that tells its Agent commands.
type CommandLister interface {
	// Commands lists the commands for sessions in workspace, in the
	// order the Agent gives them, without a native session; or
	// ErrCommandsFromSession.
	Commands(ctx context.Context, workspace string) ([]Command, error)
}

// CommandsChanged is the Agent's commands, all of them, which replace
// what it said before: as a session starts, for an Agent that tells them
// only from one, and whenever they change, as a skill is added.
type CommandsChanged struct {
	Commands []Command
}

// ContextReset reports that the Agent cleared its context, as on its
// "/clear": a NativeSessionStarted with the new native session's ID
// follows.
type ContextReset struct{}

func (CommandsChanged) isEvent() {}
func (ContextReset) isEvent()    {}
