package shell

import (
	"errors"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/appdata"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
)

// The shell words what the layers below report in the user's language
// (docs/agents/conventions.md): their errors are sentinels and types,
// their statuses structured. What it does not know, as the Agent's own
// words, it shows as it is.

// known are the errors the shell words; detail, when set, adds what the
// error says after the sentinel.
var known = []struct {
	err    error
	say    func() string
	detail bool
}{
	{workbench.ErrNotDirectory, locales.ErrNotDirectory, false},
	{workbench.ErrWorkspaceExists, locales.ErrWorkspaceExists, false},
	{workbench.ErrNoSuchWorkspace, locales.ErrNoSuchWorkspace, false},
	{workbench.ErrNoSuchSession, locales.ErrNoSuchSession, false},
	{workbench.ErrUnknownAgent, locales.ErrUnknownAgent, false},
	{workbench.ErrTurnRunning, locales.ErrTurnRunning, false},
	{workbench.ErrEmptyMessage, locales.ErrEmptyMessage, false},
	{workbench.ErrNothingToRef, locales.ErrNothingToRef, false},
	{workbench.ErrSlashCommand, locales.ErrSlashCommand, false},
	{workbench.ErrNothingToCompact, locales.ErrNothingToCompact, false},
	{workbench.ErrNeedsRecovery, locales.ErrNeedsRecovery, false},
	{workbench.ErrNoSuchReference, locales.ErrNoSuchReference, false},
	{workbench.ErrBadRange, locales.ErrBadRange, true},
	{workbench.ErrNoSuchApproval, locales.ErrNoSuchApproval, false},
	{workbench.ErrNoSuchMode, locales.ErrNoSuchMode, false},
	{workbench.ErrNoSuchRule, locales.ErrNoSuchRule, false},
	{workbench.ErrWorkspaceMissing, locales.ErrWorkspaceMissing, false},
	{workbench.ErrPathInUse, locales.ErrPathInUse, false},
	{workbench.ErrNothingToRetry, locales.ErrNothingToRetry, false},
	{workbench.ErrBadSettings, locales.ErrBadSettings, false},
	{workbench.ErrNotReadable, locales.ErrNotReadable, false},
	{agent.ErrResumeFailed, locales.ErrResumeFailed, true},
	{agent.ErrNotFound, locales.ErrAgentNotFound, false},
	{agent.ErrStartFailed, locales.ErrAgentStartFailed, true},
	{agent.ErrBusy, locales.ErrAgentBusy, false},
	{agent.ErrClosed, locales.ErrAgentClosed, true},
	{agents.ErrNotLoggedIn, locales.ErrNotLoggedIn, false},
	{agents.ErrNoInAppLogin, locales.ErrNoInAppLogin, false},
	{appdata.ErrUnavailable, locales.ErrDataUnavailable, true},
	{appdata.ErrLocked, locales.ErrDataLocked, false},
	{appdata.ErrNotEmpty, locales.ErrFolderNotEmpty, true},
}

// say words an error for the user.
func (s *Shell) say(err error) string {
	if err == nil {
		return ""
	}
	var failure *workbench.Failure
	if errors.As(err, &failure) {
		return s.sayFailure("", failure)
	}
	var unusable *agents.UnusableError
	if errors.As(err, &unusable) {
		return problem(unusable.Status)
	}
	for _, k := range known {
		if errors.Is(err, k.err) {
			if k.detail {
				return withDetail(k.say(), agent.Detail(err, k.err))
			}
			return k.say()
		}
	}
	return err.Error()
}

// sayFailure words why a turn failed; agentName names the Agent, which
// says its own failures.
func (s *Shell) sayFailure(agentName string, f *workbench.Failure) string {
	if agentName == "" {
		agentName = locales.TheAgent()
	}
	var failed agent.Failed
	if errors.As(f.Err, &failed) {
		switch {
		case failed.Exited:
			return withDetail(locales.FailAgentExited(agentName), failed.Message)
		default:
			return withDetail(locales.FailAgent(agentName), failed.Message)
		}
	}
	why := s.say(f.Err)
	switch f.Step {
	case workbench.StepSend:
		return withDetail(locales.FailSend(), why)
	case workbench.StepStart:
		return withDetail(locales.FailStart(), why)
	case workbench.StepCompact:
		return withDetail(locales.FailCompact(), why)
	case workbench.StepSave:
		return withDetail(locales.FailSave(), why)
	}
	return why
}

// failed words an operation that failed: what failed, and why.
func (s *Shell) failed(what func() string, err error) string {
	return withDetail(what(), s.say(err))
}

// withDetail adds a detail after a sentence, as "Sending failed: no
// network"; none adds nothing.
func withDetail(head, detail string) string {
	if detail == "" {
		return head
	}
	return locales.WithDetail(head, detail)
}

// problem says why an Agent is not ready.
func problem(st agents.Status) string {
	switch st.Problem {
	case agents.ProblemUnknown:
		return locales.AgentUnknown()
	case agents.ProblemBadPath:
		return locales.AgentBadPath(st.Detail)
	case agents.ProblemNotFound:
		return locales.AgentNotFound(st.Name)
	case agents.ProblemNoVersion:
		return withDetail(locales.AgentNoVersion(), st.Detail)
	case agents.ProblemBadVersion:
		return withDetail(locales.AgentBadVersion(), st.Detail)
	case agents.ProblemTooOld:
		return locales.AgentTooOld(st.Version, st.MinVersion)
	case agents.ProblemNoLogin:
		return withDetail(locales.AgentNoLogin(), st.Detail)
	case agents.ProblemBadLogin:
		return withDetail(locales.AgentBadLogin(), st.Detail)
	case agents.ProblemSignedOut:
		return locales.AgentSignedOut(st.Name)
	}
	if st.State == agents.Checking {
		return locales.AgentChecking()
	}
	return ""
}
