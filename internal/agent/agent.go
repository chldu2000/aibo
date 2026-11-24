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
	"strings"
)

// The errors of adapters the shell words for the user. An adapter wraps
// them with the Agent's own words, or the system's, as
// fmt.Errorf("%w: %s", ErrStartFailed, why); Detail returns those.
var (
	// ErrResumeFailed is what Start returns when the native session to
	// resume is lost or cannot be resumed.
	ErrResumeFailed = errors.New("the native session cannot be resumed")
	// ErrNotFound: the Agent's executable was not found.
	ErrNotFound = errors.New("the Agent was not found")
	// ErrStartFailed: the Agent's process did not start, or did not
	// answer.
	ErrStartFailed = errors.New("the Agent did not start")
	// ErrBusy: the Agent is replying, or otherwise cannot take it now.
	ErrBusy = errors.New("the Agent is busy")
	// ErrClosed: the native session was closed, or its process ended.
	ErrClosed = errors.New("the native session is closed")
)

// Detail is what err says after sentinel, which it wraps: the Agent's
// own words, or the system's; "" when it says nothing more.
func Detail(err, sentinel error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if i := strings.Index(s, sentinel.Error()); i >= 0 {
		s = s[i+len(sentinel.Error()):]
		return strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(s, ":"), "："))
	}
	return s
}

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

// Model is a model an Agent offers for its sessions.
type Model struct {
	// ID is what Start takes as StartOptions.Model; empty is the
	// Agent's default.
	ID          string
	Name        string
	Description string
	// Resolved is the model ID runs as, as the Agent reports what it uses
	// (SettingsReported): "claude-opus-5-5" for "opus". Empty when it is
	// ID itself.
	Resolved string
	// Efforts are the reasoning efforts the model takes, in order; none
	// when it takes none. DefaultEffort is its default, when the Agent
	// tells.
	Efforts       []string
	DefaultEffort string
}

// Runs reports whether m is the model id runs as, as an Agent reports
// it.
func (m Model) Runs(id string) bool {
	return id != "" && (m.ID == id || m.Resolved == id)
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
	// Model is the session's model, Effort its reasoning effort; empty
	// leaves the Agent's own.
	Model  string
	Effort string
	// ResumeID is the native session to resume; empty starts a new one.
	ResumeID string
	// MCP is the workbench's MCP server, which the Agent must be given
	// (as the server named "aibo") so that it can read its references.
	MCP *MCPServer
	// Mode is the session's permission mode (PermissionMode.ID); empty
	// is the one marked Default.
	Mode string
	// Rules are what the user allowed for the session, from earlier
	// answers (ApprovalOption.Rules), to apply again.
	Rules []Rule
	// ReadDirs are other workspaces the session may read, not write: the
	// source workspaces of references it received.
	ReadDirs []string
}

// DirsAtStart is an Agent that takes ReadDirs only when a session
// starts: a session given another must start again (resumed).
type DirsAtStart interface {
	DirsAtStart() bool
}

// PermissionMode is one of an Agent's own permission modes: how much it
// does without asking, under the Agent's own name (ADR 0003).
type PermissionMode struct {
	// ID is the adapter's own, as StartOptions.Mode and SetMode take it.
	ID string
	// Name is as the Agent shows it. Description, in English, says what
	// the mode does; the shell words it in the user's language.
	Name        string
	Description string
	Risk        Risk
	// ReadOnly is set when the Agent cannot change files in it.
	ReadOnly bool
	// Default marks the mode of a session that has none: the Agent's
	// own default, or, for Codex, what aibo always used.
	Default bool
	// Unavailable, when set, says why it cannot be chosen now, in
	// English.
	Unavailable string
}

// Risk is how much a permission mode lets the Agent do unasked.
type Risk int

const (
	// Safe: it asks, or cannot change anything.
	Safe Risk = iota
	// Caution: it does some things unasked, as editing files.
	Caution
	// Danger: it does anything unasked, outside the workspace too.
	Danger
)

// ModeLister is an Agent that tells its permission modes, in the order
// the Agent shows them.
type ModeLister interface {
	PermissionModes(ctx context.Context) ([]PermissionMode, error)
}

// Rule is something the user allowed for the rest of a session, which
// the Agent's adapter applies again when the session restarts. Grant says
// what it allows; Data is the adapter's own, which the workbench only
// keeps. Label is what rules kept before Grant say, in Chinese.
type Rule struct {
	Label string `json:",omitempty"`
	Grant Grant
	Data  json.RawMessage
}

// Grant is what an answer or a rule allows, for the shell to word.
type Grant struct {
	Kind GrantKind `json:",omitempty"`
	// Items are the rules, commands, paths, directories or the mode the
	// grant names.
	Items []string `json:",omitempty"`
}

// GrantKind is what a Grant allows.
type GrantKind string

const (
	// GrantTools: the uses of tools Items name, in the Agent's own rule
	// syntax, as "Bash(ls:*)".
	GrantTools GrantKind = "tools"
	// GrantAcceptEdits: edits, unasked, for the rest of the session.
	GrantAcceptEdits GrantKind = "accept_edits"
	// GrantMode: the session switches to the mode Items[0].
	GrantMode GrantKind = "mode"
	// GrantDirectories: access to the directories Items.
	GrantDirectories GrantKind = "directories"
	// GrantCommand: the command Items[0], as it was run.
	GrantCommand GrantKind = "command"
	// GrantCommandPrefix: the commands starting with the words Items.
	GrantCommandPrefix GrantKind = "command_prefix"
	// GrantEdits: changes to the files Items.
	GrantEdits GrantKind = "edits"
)

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
	// SetMode changes the permission mode, for the requests to come. The
	// Agent then reports it (ModeReported), as it does when it changes
	// its mode itself.
	SetMode(ctx context.Context, mode string) error
	// SetModel changes the model and the reasoning effort, empty for the
	// Agent's own, for the turns to come; only between turns. The Agent
	// then reports what it uses (SettingsReported).
	SetModel(ctx context.Context, model, effort string) error
	// Close ends the native session's process or connection.
	Close() error
}

// Turn is the user's input for one turn.
type Turn struct {
	// Text is what the Agent receives.
	Text string
	// Files are the files and directories the user mentioned, which the
	// adapter puts after Text as its Agent takes them (ADR 0004): only
	// their paths, for the Agent to read itself.
	Files []FileMention
	// Images are the images the user attached, which the adapter puts
	// before Text for the model to see (ADR 0006).
	Images []Image
}

// Image is an image a turn carries: a file the workbench keeps, of a type
// both Agents take (image/png, image/jpeg, image/gif, image/webp), within
// their size limits.
type Image struct {
	Path, MIME string
}

// FileMention is a file or directory the user mentioned in a message.
type FileMention struct {
	// Path is absolute; Rel is relative to the session's workspace, ""
	// when it is outside it (in a source workspace).
	Path, Rel string
	Dir       bool
}

// Name is how a mention is written to an Agent: Rel, or else Path.
func (f FileMention) Name() string {
	if f.Rel != "" {
		return f.Rel
	}
	return f.Path
}

// Event is one thing a native session reports.
type Event interface{ isEvent() }

// ModeReported is the permission mode the Agent says it is in
// (PermissionMode.ID): as it starts, after SetMode, and when it changes
// mode itself, as Claude Code leaving plan mode once its plan is
// approved.
type ModeReported struct {
	ID string
}

// SettingsReported is the model and the reasoning effort the Agent says
// it uses, as it starts and after SetModel: what it really runs, not what
// was asked. Either is empty when the Agent does not say.
type SettingsReported struct {
	Model  string
	Effort string
}

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
	ChildThread  string
	NativeThread string
	ToolID       string
	Parent       string
	Name         string
	Input        json.RawMessage
	Raw          json.RawMessage
}

// ToolOutputDelta appends a chunk of output to an active tool call.
type ToolOutputDelta struct{ ToolID, Text string }

// ToolFinished reports a tool call's result.
type ToolFinished struct {
	NativeThread string
	// KeepStreamedOutput means the completion omitted its aggregate.
	KeepStreamedOutput bool
	ToolID             string
	Parent             string
	Output             string
	IsError            bool
	Declined           bool
	ExitCode           *int
	Raw                json.RawMessage
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
	// Action is what is asked; Tool names the tool of ActionTool, or the
	// MCP server or tool of ActionMCP.
	Action  Action
	Tool    string
	Command string
	Cwd     string
	Reason  string
	// Diff is the change a file edit makes, as a unified diff.
	Diff string
	// Plan is the plan to approve before the Agent acts on it, in
	// Markdown, as Claude Code's ExitPlanMode.
	Plan string
	// Paths are the files it writes.
	Paths []string
	// WriteRoot, when set, is a directory the Agent asks to write in for
	// the rest of the session.
	WriteRoot string
	// Input is the tool's input, for the other tools.
	Input json.RawMessage
	// Options are the Agent's own answers, in the order to show.
	Options []ApprovalOption
}

// ApprovalOption is one answer to an approval request.
type ApprovalOption struct {
	ID   string
	Kind OptionKind
	// Grants, for AllowSession and AllowAlways, are what the option
	// allows, one for each rule; a rule may be as long as a command.
	Grants []Grant `json:",omitempty"`
	// Detail is what answers kept before Grants say they allow, in
	// Chinese.
	Detail []string `json:",omitempty"`
	// Where, for AllowAlways, is the file the Agent writes the rule in;
	// empty when it is the Agent's own rules.
	Where string
	// Rules, for AllowSession, are what the session allows from then on.
	Rules []Rule `json:",omitempty"`
}

// Action is what an approval request asks for.
type Action string

const (
	ActionCommand Action = "command" // run a command
	ActionEdit    Action = "edit"    // change files
	ActionPlan    Action = "plan"    // act on a plan
	ActionMCP     Action = "mcp"     // call an MCP tool
	ActionTool    Action = "tool"    // use another tool
)

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

// NotLoggedIn reports that the Agent is signed out, or its sign-in
// expired: it can do nothing until the user signs in again.
type NotLoggedIn struct{}

// TurnEnded ends the running turn.
type TurnEnded struct {
	// Interrupted is set when the turn was stopped before it finished.
	Interrupted bool
}

// Failed reports an error of the turn or the session, in the Agent's own
// words, which may be none. A turn that fails still ends with TurnEnded.
type Failed struct {
	Message string
	// Exited is set when the Agent's process ended unexpectedly; Message
	// is then how it exited, and what it wrote to stderr.
	Exited bool
}

// Error makes a failure an error, as the workbench keeps it.
func (f Failed) Error() string { return f.Message }

// Retrying reports that the Agent could not reach its model and tries
// again by itself, as when the network drops: the turn goes on, silent
// meanwhile. Attempt and Max count the tries when the Agent counts them;
// Message says why, in the Agent's own words.
type Retrying struct {
	Attempt, Max int
	Message      string
}

func (NativeSessionStarted) isEvent() {}
func (SettingsReported) isEvent()     {}
func (ModeReported) isEvent()         {}
func (ReplyDelta) isEvent()           {}
func (ThinkingDelta) isEvent()        {}
func (ReplyDone) isEvent()            {}
func (ToolStarted) isEvent()          {}
func (ToolFinished) isEvent()         {}
func (ToolOutputDelta) isEvent()      {}
func (PlanUpdated) isEvent()          {}
func (ApprovalRequested) isEvent()    {}
func (Compacted) isEvent()            {}
func (NotLoggedIn) isEvent()          {}
func (TurnEnded) isEvent()            {}
func (Failed) isEvent()               {}
func (Retrying) isEvent()             {}
