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
	"errors"
)

// ErrResumeFailed is what Start returns, wrapped with the Agent's own
// words, when the native session to resume is lost or cannot be resumed.
var ErrResumeFailed = errors.New("原生会话无法续接")

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
	// ToolName is how the Agent's model sees the workbench MCP server's
	// tool, for the reference briefs to name it as the Agent sees it.
	ToolName(tool string) string
}

// MCPServer is the workbench's MCP server as one session reaches it.
type MCPServer struct {
	// URL is the streamable HTTP endpoint.
	URL string
	// Token is the session's bearer token.
	Token string
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
	// MCP is the workbench's MCP server, which the Agent must be given
	// (as the server named "aibo") so that it can read its references.
	MCP *MCPServer
	// Level is the session's approval level.
	Level ApprovalLevel
	// Rules are what the user allowed for the session, from earlier
	// answers (ApprovalOption.Rules), to apply again.
	Rules []Rule
}

// ApprovalLevel is how much the Agent may do without asking, mapped to
// each Agent's own settings.
type ApprovalLevel string

const (
	// AskAlways asks before anything the Agent asks about by default.
	AskAlways ApprovalLevel = "ask"
	// AcceptEdits lets the Agent change files in the workspace without
	// asking.
	AcceptEdits ApprovalLevel = "edits"
	// FullAuto lets the Agent do anything without asking.
	FullAuto ApprovalLevel = "auto"
)

// Rule is something the user allowed for the rest of a session, which
// the Agent's adapter applies again when the session restarts. Data is
// the adapter's own; the workbench only keeps it.
type Rule struct {
	Label string
	Data  json.RawMessage
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
	// RespondApproval answers the approval request id with one of its
	// options; note, for a denial, tells the Agent why.
	RespondApproval(ctx context.Context, id string, optionID string, note string) error
	// Compact compacts the Agent's context, as a turn of its own, which
	// reports Compacted and ends with TurnEnded.
	Compact(ctx context.Context) error
	// SetLevel changes the approval level, for the turns to come.
	SetLevel(ctx context.Context, level ApprovalLevel) error
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

// Parent, on the events of messages, is the ID of the tool call (a
// subagent's) they belong to; empty for the session's own messages.

// ReplyDelta appends text to the Agent's reply ReplyID, starting it on
// its first delta. Raw is the Agent's own event, kept for later
// inspection.
type ReplyDelta struct {
	ReplyID string
	Parent  string
	Text    string
	Raw     json.RawMessage
}

// ThinkingDelta appends to the reasoning of the reply ReplyID, starting
// the reply if it has not started.
type ThinkingDelta struct {
	ReplyID string
	Parent  string
	Text    string
}

// ReplyDone ends the reply ReplyID. Text, when not empty, is its full
// text, replacing what the deltas built.
type ReplyDone struct {
	ReplyID string
	Parent  string
	Text    string
	Raw     json.RawMessage
}

// ToolStarted reports a tool call the Agent made, with its input.
type ToolStarted struct {
	ToolID string
	Parent string
	Name   string
	Input  json.RawMessage
	Raw    json.RawMessage
}

// ToolFinished reports a tool call's result.
type ToolFinished struct {
	ToolID  string
	Parent  string
	Output  string
	IsError bool
	Raw     json.RawMessage
}

// PlanUpdated reports the Agent's plan, whole; a later update of the same
// PlanID replaces it.
type PlanUpdated struct {
	PlanID string
	Items  []PlanItem
	Raw    json.RawMessage
}

// PlanItem is one step of a plan.
type PlanItem struct {
	Text   string
	Status PlanStatus
}

// PlanStatus is where a step of a plan is.
type PlanStatus string

const (
	PlanPending    PlanStatus = "pending"
	PlanInProgress PlanStatus = "in_progress"
	PlanCompleted  PlanStatus = "completed"
)

// ApprovalRequested asks the user to allow what the Agent is about to
// do. It waits, without a time limit, for RespondApproval.
type ApprovalRequested struct {
	ID string
	// ToolID is the tool call it gates, which may start after it.
	ToolID string
	// Title says what is asked, as "执行命令".
	Title   string
	Command string
	Cwd     string
	Reason  string
	// Diff is the change a file edit makes, as a unified diff.
	Diff string
	// Paths are the files it writes.
	Paths []string
	// Input is the tool's input, for the other tools.
	Input json.RawMessage
	// Options are the Agent's own answers, in the order to show.
	Options []ApprovalOption
}

// ApprovalOption is one answer to an approval request.
type ApprovalOption struct {
	ID    string
	Kind  OptionKind
	Label string
	// Where, for AllowAlways, is where the Agent writes the rule.
	Where string
	// Rules, for AllowSession, are what the session allows from then on.
	Rules []Rule `json:",omitempty"`
}

// OptionKind is what an answer does.
type OptionKind string

const (
	AllowOnce    OptionKind = "allow_once"
	AllowSession OptionKind = "allow_session"
	AllowAlways  OptionKind = "allow_always"
	Deny         OptionKind = "deny"
	DenyStop     OptionKind = "deny_stop"
)

// Compacted reports that the Agent compacted its context. Tokens are
// zero when the Agent does not say.
type Compacted struct {
	// Trigger is "manual" when asked for (Session.Compact), else "auto".
	Trigger    string
	PreTokens  int
	PostTokens int
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
func (ThinkingDelta) isEvent()        {}
func (ReplyDone) isEvent()            {}
func (ToolStarted) isEvent()          {}
func (ToolFinished) isEvent()         {}
func (PlanUpdated) isEvent()          {}
func (ApprovalRequested) isEvent()    {}
func (Compacted) isEvent()            {}
func (TurnEnded) isEvent()            {}
func (Failed) isEvent()               {}
