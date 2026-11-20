// Package agent defines the Agent adapter: the one interface through which
// the workbench drives an external Agent (Claude Code, Codex, or the
// scripted fake used in tests). Each adapter turns its Agent's protocol
// into the same stream of Events.
//
// The adapter is the primary test seam: tests swap the real adapters for
// the scripted fake (package agent/fake) and keep everything else real.
package agent

import (
	"context"
	"encoding/json"
)

// Kind names an Agent implementation, as stored with each session.
type Kind string

// Agent starts native sessions of one Agent implementation.
type Agent interface {
	// Kind is the implementation's stable name, stored with sessions.
	Kind() Kind
	// Name is shown to the user, e.g. "Claude Code".
	Name() string
	// Start starts a native session, or resumes the one named by
	// StartOptions.ResumeID.
	Start(ctx context.Context, opts StartOptions) (Session, error)
}

// StartOptions configures a native session.
type StartOptions struct {
	// Workspace is the absolute path the Agent runs in.
	Workspace string
	// Model is the model chosen when the session was created; empty
	// leaves the Agent's default.
	Model string
	// ResumeID is the native session to resume; empty starts a new one.
	ResumeID string
}

// Session is one running native session.
type Session interface {
	// Events delivers the session's events in order. It is closed after
	// Close, or when the Agent's process ends.
	Events() <-chan Event
	// Send starts a turn with the user's input. Its events arrive on
	// Events, ending with TurnEnded.
	Send(ctx context.Context, turn Turn) error
	// Interrupt stops the running turn, which then ends with
	// TurnEnded{Interrupted: true}. Without a running turn it does nothing.
	Interrupt(ctx context.Context) error
	// Close ends the native session's process or connection.
	Close() error
}

// Turn is the user's input for one turn.
type Turn struct {
	// Text is what the Agent receives.
	Text string
}

// Event is one thing a native session reports.
type Event interface{ isEvent() }

// NativeSessionStarted reports the ID of the native session, once known,
// so that it can be resumed later.
type NativeSessionStarted struct {
	ID string
}

// ReplyDelta appends text to the Agent's reply ReplyID, starting it on
// its first delta. Raw is the Agent's own event, kept for later
// inspection.
type ReplyDelta struct {
	ReplyID string
	Text    string
	Raw     json.RawMessage
}

// ReplyDone ends the reply ReplyID. Text, when not empty, is its full
// text, replacing what the deltas built.
type ReplyDone struct {
	ReplyID string
	Text    string
	Raw     json.RawMessage
}

// TurnEnded ends the running turn.
type TurnEnded struct {
	// Interrupted is set when the turn was stopped before it finished.
	Interrupted bool
}

// Failed reports an error of the turn or the session, in the Agent's own
// words. A turn that fails still ends with TurnEnded.
type Failed struct {
	Message string
}

func (NativeSessionStarted) isEvent() {}
func (ReplyDelta) isEvent()           {}
func (ReplyDone) isEvent()            {}
func (TurnEnded) isEvent()            {}
func (Failed) isEvent()               {}
