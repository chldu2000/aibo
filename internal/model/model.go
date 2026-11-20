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
	// Tool is a tool call's name, input and result.
	Tool *Tool
	// Plan is a plan's steps.
	Plan []agent.PlanItem
	// Children are the messages of a subagent, inside the tool call that
	// ran it. They have no sequence numbers of their own; AgentID, the
	// Agent's ID of a child, is how later events find it.
	Children []Message
	AgentID  string `json:",omitempty"`
	// Refs are the IDs of the references a user message delivered, in
	// the order their blocks preceded its text.
	Refs []string
	// Raw is the Agent's own event the message came from, for internal
	// use only.
	Raw        json.RawMessage
	CreatedAt  time.Time
	FinishedAt time.Time
}

// Tool is a tool call: what the Agent called, and what came back.
type Tool struct {
	Name  string
	Input json.RawMessage
	// Output is the result, cut to MaxToolOutput bytes (Truncated).
	Output    string
	IsError   bool
	Truncated bool
	// Done is set once the result came.
	Done bool
}

// MaxToolOutput is the most of a tool call's output kept.
const MaxToolOutput = 1 << 20

// ReferenceState is whether a reference has been delivered.
type ReferenceState string

const (
	// Draft references wait in the receiving session's composer.
	Draft ReferenceState = "draft"
	// Delivered references were sent with a user message.
	Delivered ReferenceState = "delivered"
)

// Reference is a session reference: a handle on a range of a source
// session's messages, handed with its brief to a receiving session. It is
// a snapshot, fixed when created.
type Reference struct {
	ID string
	// SourceID is the referenced session, which may since have been
	// deleted. SourceTitle, SourceAgent and SourceWorkspace are as they
	// were when the reference was created.
	SourceID        string
	SourceTitle     string
	SourceAgent     agent.Kind
	SourceWorkspace string
	// From and To are the first and last sequence numbers of the range,
	// which holds Count messages.
	From, To int
	Count    int
	// TargetID is the receiving session.
	TargetID string
	// Brief is the text the receiving Agent gets, fixed at creation.
	Brief string
	State ReferenceState
	// MessageSeq is the receiving session's user message that delivered
	// the reference, once delivered.
	MessageSeq int
	CreatedAt  time.Time
	// Reads are the receiving Agent's reads of the reference, oldest
	// first.
	Reads []ReferenceRead
}

// ReferenceRead records that the receiving Agent read messages From..To
// of a reference.
type ReferenceRead struct {
	From, To int
	At       time.Time
}
