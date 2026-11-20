// Package model holds the workbench's domain types, shared by the store,
// the workbench core and the shell UI. The vocabulary is GLOSSARY.md's.
package model

import (
	"encoding/json"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
)

// Workspace is a project directory that sessions belong to, identified by
// its absolute path.
type Workspace struct {
	ID        string
	Path      string
	CreatedAt time.Time
}

// Session is a conversation between the user and one Agent.
type Session struct {
	ID          string
	WorkspaceID string
	Agent       agent.Kind
	Model       string
	// Title is the session's title: one the user set (TitleManual), or
	// else the start of its first user message; empty until then.
	Title       string
	TitleManual bool
	// NativeIDs are the native sessions this session has had, oldest
	// first; the last is the current one. Empty until the Agent reports
	// one.
	NativeIDs []string
	CreatedAt time.Time
	ActiveAt  time.Time
}

// NativeID is the current native session's ID, or "".
func (s Session) NativeID() string {
	if len(s.NativeIDs) == 0 {
		return ""
	}
	return s.NativeIDs[len(s.NativeIDs)-1]
}

// MessageKind is what a message is.
type MessageKind string

const (
	UserMessage MessageKind = "user"
	AgentReply  MessageKind = "reply"
	ToolCall    MessageKind = "tool"
	Plan        MessageKind = "plan"
)

// MessageState is where a message is in its life. A message only changes
// while it is Streaming; once it ends (Done or Interrupted) it never
// changes again.
type MessageState string

const (
	Streaming   MessageState = "streaming"
	Done        MessageState = "done"
	Interrupted MessageState = "interrupted"
)

// Ended reports whether the message can no longer change.
func (s MessageState) Ended() bool { return s != Streaming }

// Message is one entry of a session's timeline, addressed by its Seq: a
// number that only grows within the session and is never reused.
type Message struct {
	Seq   int
	Kind  MessageKind
	State MessageState
	// Text is the user's own words for a user message (without any
	// reference blocks), or the Agent's text.
	Text string
	// Thinking is the Agent's reasoning attached to a reply.
	Thinking string
	// Raw is the Agent's own event the message came from, for internal
	// use only.
	Raw        json.RawMessage
	CreatedAt  time.Time
	FinishedAt time.Time
}
