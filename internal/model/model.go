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
	// Removed is set when the user removed it: its sessions are archived.
	Removed bool
	// Missing is set when its directory is gone (moved, deleted, on a
	// disk not mounted): its sessions can be read, not continued.
	Missing bool
}

// Session is a conversation between the user and one Agent.
type Session struct {
	ID          string
	WorkspaceID string
	Agent       agent.Kind
	// Model and Effort are the model and the reasoning effort chosen for
	// the session; empty leaves the Agent's own.
	Model  string
	Effort string
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
	// Archived hides the session from its workspace's group; it can still
	// be read, searched and referenced.
	Archived bool
	// Mode is the permission mode (agent.PermissionMode.ID), empty for
	// the one the Agent marks Default; Rules what the user allowed for the rest
	// of the session.
	Mode  string
	Rules []agent.Rule
	// ReadDirs are other workspaces the session may read, not write: the
	// source workspaces of references it received. It keeps them.
	ReadDirs []string
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
	// Mentions are the files a user message mentioned (ADR 0004).
	Mentions []Mention `json:",omitempty"`
	// Attachments are the images a user message carried (ADR 0006).
	Attachments []Attachment `json:",omitempty"`
	// Command is the Agent command a user message invoked (ADR 0008);
	// its Text is then what followed the command.
	Command *CommandCall `json:",omitempty"`
	// CommandOutput marks a reply that is what an Agent command printed,
	// not the model's words.
	CommandOutput bool `json:",omitempty"`
	// Raw is the Agent's own event the message came from, for internal
	// use only.
	Raw        json.RawMessage
	CreatedAt  time.Time
	FinishedAt time.Time
}

// Mention is a file or directory a user message mentioned: only its path,
// which the Agent reads itself; not a snapshot, as a reference is.
type Mention struct {
	// Path is absolute. WorkspaceID is the workspace it is in: the
	// session's own, or a source workspace it may read.
	Path        string
	WorkspaceID string
	Dir         bool `json:",omitempty"`
}

// Attachment is an image a user message carried: a copy kept in the
// data directory, which the Agent sees itself (ADR 0006), unlike a
// mention's path.
type Attachment struct {
	// Name is the file's name as the user knew it, "image.png" for a
	// pasted one.
	Name string
	// File is where the copy is, relative to the data directory's
	// attachments directory, with slashes: "<session ID>/<ID>.png".
	File string
	// MIME is its type: image/png, image/jpeg, image/gif or image/webp.
	MIME          string
	Width, Height int
	Size          int64
}

// Tool is a tool call: what the Agent called, and what came back.
type Tool struct {
	ChildThread  string `json:",omitempty"`
	NativeThread string `json:",omitempty"`
	NativeItem   string `json:",omitempty"`
	Name         string
	Input        json.RawMessage
	// Output is the result, cut to MaxToolOutput bytes (Truncated).
	Output    string
	IsError   bool
	Declined  bool `json:",omitempty"`
	ExitCode  *int `json:",omitempty"`
	Truncated bool
	// Done is set once the result came.
	Done bool
	// Approval is the user's answer to the Agent's asking to run it.
	Approval *Approval `json:",omitempty"`
}

// Approval is an approval request and, once answered, the answer.
type Approval struct {
	ID string
	// Action is what is asked, Tool the tool or MCP server it names
	// (agent.ApprovalRequested). Title is what requests kept before
	// Action say, in Chinese.
	Action    agent.Action `json:",omitempty"`
	Tool      string       `json:",omitempty"`
	Title     string       `json:",omitempty"`
	WriteRoot string       `json:",omitempty"`
	Command   string       `json:",omitempty"`
	Cwd       string       `json:",omitempty"`
	Reason    string       `json:",omitempty"`
	Diff      string       `json:",omitempty"`
	Plan      string       `json:",omitempty"`
	Paths     []string
	Input     json.RawMessage `json:",omitempty"`
	// Outside is set when it writes outside the session's workspace.
	Outside bool
	Options []agent.ApprovalOption
	// Answer is the option chosen; empty while pending. Note is what the
	// user said with a denial.
	Answer *agent.ApprovalOption `json:",omitempty"`
	Note   string                `json:",omitempty"`
	// Expired is set when the turn ended before an answer.
	Expired bool `json:",omitempty"`
}

// Pending reports whether the request waits for an answer.
func (a *Approval) Pending() bool { return a != nil && a.Answer == nil && !a.Expired }

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

// Clone copies m deeply, so that the copy shares nothing that changes.
func (m Message) Clone() Message {
	if m.Tool != nil {
		t := *m.Tool
		if t.ExitCode != nil {
			code := *t.ExitCode
			t.ExitCode = &code
		}
		if t.Approval != nil {
			a := *t.Approval
			if a.Answer != nil {
				ans := *a.Answer
				a.Answer = &ans
			}
			a.Options = append([]agent.ApprovalOption(nil), a.Options...)
			a.Paths = append([]string(nil), a.Paths...)
			t.Approval = &a
		}
		m.Tool = &t
	}
	m.Plan = append([]agent.PlanItem(nil), m.Plan...)
	if m.Children != nil {
		cs := make([]Message, len(m.Children))
		for i, c := range m.Children {
			cs[i] = c.Clone()
		}
		m.Children = cs
	}
	m.Refs = append([]string(nil), m.Refs...)
	m.Mentions = append([]Mention(nil), m.Mentions...)
	m.Attachments = append([]Attachment(nil), m.Attachments...)
	if m.Command != nil {
		c := *m.Command
		m.Command = &c
	}
	return m
}

// CommandCall is the Agent command a user message invoked: its name, and
// its description as the Agent told it when the message was sent, kept
// for when the Agent no longer tells it.
type CommandCall struct {
	Name        string
	Description string `json:",omitempty"`
}

// MarkerKind is what a marker marks.
type MarkerKind string

const (
	// Compaction marks where the Agent compacted its context.
	Compaction MarkerKind = "compaction"
	// Reset marks where a new native session took over: one the user
	// chose (Recover), or the Agent's own after it cleared its context.
	Reset MarkerKind = "reset"
	// CommandRan marks an Agent command that ran and said nothing, after
	// the message that invoked it.
	CommandRan MarkerKind = "command_ran"
	// TurnEnded marks where a turn ended: how long it took, and whether
	// it was stopped.
	TurnEnded MarkerKind = "turn_ended"
)

// Marker marks something that happened in a session after message
// AfterSeq (0: before any). It is not a message: it has no sequence
// number of its own and cannot be referenced.
type Marker struct {
	AfterSeq int
	Kind     MarkerKind
	// Trigger and the tokens are a compaction's: "auto" or "manual", and
	// the context's size before and after, zero when unknown.
	Trigger    string
	PreTokens  int
	PostTokens int
	// Took and Stopped are a turn's end: how long it ran, and whether it
	// ended interrupted rather than done.
	Took    time.Duration
	Stopped bool
	At      time.Time
}
