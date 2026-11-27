package workbench

import (
	"context"
	"errors"
	"slices"

	"github.com/chldu2000/aibo/internal/agent"
)

// The Agent commands a session can invoke (GLOSSARY: Agent command): as
// its Agent tells them, kept in memory only, one list for each Agent and
// workspace, shared by their sessions.

// CommandDemand is what CommandList may do for a list.
type CommandDemand int

const (
	// PeekCommands reads only what is already known.
	PeekCommands CommandDemand = iota
	// LoadCommands asks for the list unless it is known, or failed.
	LoadCommands
	// RefreshCommands asks for it again, showing what is known
	// meanwhile, and retries a failure: as the user opens the panel.
	RefreshCommands
)

// CommandList is a session's Agent commands, as last told.
type CommandList struct {
	Commands []agent.Command
	// Loading is set while they are asked for; Commands are then the
	// ones told before, if any.
	Loading bool
	// Err is why they could not be had.
	Err error
}

// commandKey is whose a command list is: an Agent's, in a workspace.
type commandKey struct {
	kind      agent.Kind
	workspace string
}

type commandListEntry struct {
	source ModelSource
	cancel context.CancelFunc
	list   CommandList
	// waiting is the session whose native session was started to tell
	// them, while it has not.
	waiting string
}

// TellsCommands reports whether an Agent tells its commands
// (agent.CommandLister): for one that does not, "/" starts no command.
func (w *Workbench) TellsCommands(kind agent.Kind) bool {
	_, ok := w.agent(kind).(agent.CommandLister)
	return ok
}

// CommandList returns the commands of a session's Agent in its workspace,
// for the installation and sign-in source. Asking for them (demand)
// happens in the background, and every window is told when they come.
//
// An Agent that tells them only from a native session has the session's
// own start for it (ErrCommandsFromSession): the next message goes on in
// that native session. What a running native session tells is the list.
func (w *Workbench) CommandList(sessionID string, source ModelSource, demand CommandDemand) CommandList {
	w.mu.Lock()
	defer w.mu.Unlock()
	s, ok := w.sessions[sessionID]
	if !ok {
		return CommandList{Err: ErrNoSuchSession}
	}
	lister, ok := w.agent(s.info.Agent).(agent.CommandLister)
	if !ok {
		return CommandList{}
	}
	ws, _ := w.workspace(s.info.WorkspaceID)
	key := commandKey{s.info.Agent, ws.Path}
	entry := w.commandLists[key]
	if entry != nil && entry.source != source {
		entry.cancel()
		delete(w.commandLists, key)
		entry = nil
	}
	if s.commands != nil {
		// Its native session told them: they are the Agent's now.
		if entry == nil {
			entry = w.newCommandEntry(key, source)
		}
		entry.cancel()
		entry.list, entry.waiting = CommandList{Commands: slices.Clone(s.commands)}, ""
		return entry.list
	}
	if entry != nil && (entry.list.Loading || demand != RefreshCommands) {
		return copyCommands(entry.list)
	}
	if w.closing || demand == PeekCommands {
		return CommandList{}
	}
	if entry == nil {
		entry = w.newCommandEntry(key, source)
	}
	ctx, cancel := context.WithCancel(context.Background())
	entry.cancel = cancel
	entry.list = CommandList{Commands: entry.list.Commands, Loading: true}
	w.pumps.Add(1)
	go func() {
		defer w.pumps.Done()
		defer cancel()
		list, err := lister.Commands(ctx, ws.Path)
		if errors.Is(err, agent.ErrCommandsFromSession) {
			w.mu.Lock()
			if w.commandLists[key] == entry && entry.list.Loading {
				entry.waiting = sessionID
			}
			w.mu.Unlock()
			if err = w.prestart(sessionID); err == nil {
				// The native session tells them (CommandsChanged).
				return
			}
		}
		w.mu.Lock()
		current := !w.closing && w.commandLists[key] == entry && ctx.Err() == nil
		if current {
			entry.waiting = ""
			if err != nil {
				entry.list = CommandList{Commands: entry.list.Commands, Err: err}
			} else {
				entry.list = CommandList{Commands: list}
			}
		}
		w.mu.Unlock()
		if current {
			w.notify(Change{})
		}
	}()
	return copyCommands(entry.list)
}

// newCommandEntry starts a list's entry; w.mu is held.
func (w *Workbench) newCommandEntry(key commandKey, source ModelSource) *commandListEntry {
	if w.commandLists == nil {
		w.commandLists = make(map[commandKey]*commandListEntry)
	}
	entry := &commandListEntry{source: source, cancel: func() {}}
	w.commandLists[key] = entry
	return entry
}

func copyCommands(l CommandList) CommandList {
	l.Commands = slices.Clone(l.Commands)
	return l
}

// commandsTold keeps what a session's native session told of its
// commands, as the list of its Agent in its workspace; w.mu is held.
func (w *Workbench) commandsTold(s *session, cmds []agent.Command) {
	s.commands = slices.Clone(cmds)
	if s.commands == nil {
		s.commands = []agent.Command{}
	}
	ws, _ := w.workspace(s.info.WorkspaceID)
	if entry := w.commandLists[commandKey{s.info.Agent, ws.Path}]; entry != nil {
		entry.cancel()
		entry.list, entry.waiting = CommandList{Commands: slices.Clone(s.commands)}, ""
	}
}

// commandsGone forgets what a session's native session told, as it ends;
// a list waiting on it fails. w.mu is held.
func (w *Workbench) commandsGone(id string, s *session) {
	s.commands = nil
	ws, _ := w.workspace(s.info.WorkspaceID)
	if entry := w.commandLists[commandKey{s.info.Agent, ws.Path}]; entry != nil && entry.waiting == id {
		entry.list, entry.waiting = CommandList{Commands: entry.list.Commands, Err: agent.ErrClosed}, ""
	}
}

// forgetCommands drops the command lists of an Agent; w.mu is held.
func (w *Workbench) forgetCommands(kind agent.Kind) {
	for key, entry := range w.commandLists {
		if key.kind == kind {
			entry.cancel()
			delete(w.commandLists, key)
		}
	}
}

// SlashCommandError is why a message starting with "/word" was not sent:
// the word is no command the Agent can run now. It is ErrSlashCommand.
type SlashCommandError struct {
	// Agent is the Agent's name; Command the word.
	Agent, Command string
	Reason         SlashReason
}

// SlashReason is why "/word" is no command.
type SlashReason int

const (
	// NotACommand: the Agent told its commands, and it is none of them.
	NotACommand SlashReason = iota
	// CommandsUnknown: the Agent's commands are not known now: not told
	// yet, or they could not be had.
	CommandsUnknown
	// NoCommands: the Agent tells no commands aibo can invoke.
	NoCommands
)

func (e *SlashCommandError) Error() string {
	switch e.Reason {
	case CommandsUnknown:
		return "/" + e.Command + ": the commands of " + e.Agent + " are not known now"
	case NoCommands:
		return "/" + e.Command + ": " + e.Agent + " tells no commands"
	}
	return "/" + e.Command + " is not a command of " + e.Agent
}

func (e *SlashCommandError) Unwrap() error { return ErrSlashCommand }

// knownCommands are the commands a session's Agent last told, and
// whether it told them; w.mu is held.
func (w *Workbench) knownCommands(s *session) ([]agent.Command, bool) {
	if s.commands != nil {
		return s.commands, true
	}
	ws, _ := w.workspace(s.info.WorkspaceID)
	entry := w.commandLists[commandKey{s.info.Agent, ws.Path}]
	if entry == nil || entry.list.Commands == nil && (entry.list.Loading || entry.list.Err != nil) {
		return nil, false
	}
	return entry.list.Commands, true
}

// isCommand reports whether name is a command the session's Agent told;
// w.mu is held.
func (w *Workbench) isCommand(s *session, name string) bool {
	cmds, _ := w.knownCommands(s)
	return slices.ContainsFunc(cmds, func(c agent.Command) bool { return c.Answers(name) })
}

// slashError says why "/word" is no command; w.mu is held.
func (w *Workbench) slashError(s *session, word string) error {
	e := &SlashCommandError{Command: word}
	a := w.agent(s.info.Agent)
	if a != nil {
		e.Agent = a.Name()
	}
	if _, ok := a.(agent.CommandLister); !ok {
		e.Reason = NoCommands
	} else if _, known := w.knownCommands(s); !known {
		e.Reason = CommandsUnknown
	}
	return e
}

// invoked is the command name names, as the Agent last told it: one it
// no longer tells, as removed since it was chosen, goes as it is, for the
// Agent to say. w.mu is held.
func (w *Workbench) invoked(s *session, name string) (agent.Command, error) {
	cmds, _ := w.knownCommands(s)
	i := slices.IndexFunc(cmds, func(c agent.Command) bool { return c.Answers(name) })
	if i < 0 {
		return agent.Command{Name: name}, nil
	}
	c := cmds[i]
	c.Aliases = slices.Clone(c.Aliases)
	switch c.Handling {
	case agent.ByAgent, agent.ByReset:
		return c, nil
	}
	return agent.Command{}, errControlCommand
}

// errControlCommand: a command the workbench's own controls carry out.
var errControlCommand = errors.New("the command is carried out by the workbench's controls")

// commandText is a user message as written, with its command.
func commandText(cmd *agent.Command, text string) string {
	if cmd == nil {
		return text
	}
	if text == "" {
		return "/" + cmd.Name
	}
	return "/" + cmd.Name + " " + text
}

// prestart starts a session's native session before its first message,
// for it to tell its commands, unless one runs. What stops a message
// stops it too, and a native session that cannot be resumed waits for the
// user (Recover), as it would on sending.
func (w *Workbench) prestart(id string) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	switch {
	case !ok:
		w.mu.Unlock()
		return ErrNoSuchSession
	case w.closing:
		w.mu.Unlock()
		return errWorkbenchClosing
	case s.resumeFailed != nil:
		w.mu.Unlock()
		return ErrNeedsRecovery
	case s.native != nil:
		w.mu.Unlock()
		return nil
	}
	if w.ready != nil {
		if err := w.ready(s.info.Agent); err != nil {
			w.mu.Unlock()
			return err
		}
	}
	ws, _ := w.workspace(s.info.WorkspaceID)
	if ws.Missing {
		w.mu.Unlock()
		return ErrWorkspaceMissing
	}
	if err := w.load(id, s); err != nil {
		w.mu.Unlock()
		return err
	}
	info := s.info
	w.mu.Unlock()
	w.log.Info("native session started for its commands", "session", id, "agent", string(info.Agent))
	if _, err := w.connect(id, info, ws); err != nil {
		w.log.Warn("native session did not start", "session", id, "error", err.Error())
		if errors.Is(err, agent.ErrNotLoggedIn) && w.loggedOut != nil {
			go w.loggedOut(info.Agent)
		}
		if errors.Is(err, agent.ErrResumeFailed) {
			w.mu.Lock()
			if s, ok := w.sessions[id]; ok && s.native == nil {
				s.resumeFailed, s.readOnly = err, false
			}
			w.mu.Unlock()
			w.notify(Change{SessionID: id})
		}
		return err
	}
	return nil
}
