package shell

import (
	"encoding/json"
	"strconv"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

func (s *Shell) inspectorTitle() string {
	if s.detail.page == workbench.Delegations {
		return locales.DelegationHistory()
	}
	return locales.CommandHistory()
}

func (s *Shell) openActivities(id string, kind workbench.ActivityKind, fromBadge bool) {
	s.detail.open, s.detail.page, s.detail.selected = true, kind, ""
	s.detail.confirming = ""
	if fromBadge {
		for _, a := range workbench.Activities(s.view(id).msgs, kind) {
			if a.Active {
				if s.detail.selected != "" {
					s.detail.selected = ""
					return
				}
				s.detail.selected = a.ID
			}
		}
	}
}

func callState(a workbench.Activity) string {
	m, tool := a.Message, a.Message.Tool
	if tool.Declined || tool.Approval != nil && tool.Approval.Answer != nil &&
		(tool.Approval.Answer.Kind == agent.Deny || tool.Approval.Answer.Kind == agent.DenyStop) {
		return locales.CallDeclined()
	}
	switch {
	case a.Active:
		return locales.CallActive()
	case m.State == model.Interrupted:
		return locales.Interrupted()
	case tool.IsError:
		return locales.ToolResultError()
	case tool.Done:
		return locales.CallReturned()
	default:
		return locales.CallUnknown()
	}
}

func (s *Shell) activityPage(c *ui.Context, x model.Session) {
	v := s.view(x.ID)
	items := workbench.Activities(v.msgs, s.detail.page)
	ui.Column(c).Gap(6).Padding(4).Children(func() {
		for _, a := range items {
			if a.ID == s.detail.selected {
				ui.Text(c, callState(a)).FontSize(12).TextColor(c.Theme().TextMuted)
				if s.detail.page == workbench.Delegations {
					s.delegationDetail(c, v, a)
				} else {
					s.commandDetail(c, v, a)
				}
				return
			}
		}
		s.detail.selected = ""
		if len(items) == 0 {
			ui.Text(c, locales.NoActivities()).TextColor(c.Theme().TextMuted)
		}
		for _, a := range items {
			label := "#" + a.ID + " · " + gist(a.Message.Tool.Input)
			row := pickRow(c, a.ID, label, func() {
				ui.Column(c).Gap(3).MinWidth(0).Grow(1).Children(func() {
					ui.Text(c, label).MaxLines(2).TextColor(c.Theme().Text)
					ui.Text(c, callState(a)).FontSize(11).TextColor(c.Theme().TextMuted)
				})
			})
			if row.Clicked() {
				s.detail.selected = a.ID
			}
		}
	})
}

// delegationDetail shows the recorded timeline without the actionable
// approval controls of a live conversation.
func (s *Shell) delegationDetail(c *ui.Context, v *sessionView, a workbench.Activity) {
	m := a.Message
	var task struct{ Description, Prompt string }
	_ = json.Unmarshal(m.Tool.Input, &task)
	if task.Description != "" {
		ui.Text(c, task.Description).Bold().TextColor(c.Theme().Text)
	}
	if task.Prompt != "" {
		ui.Text(c, task.Prompt).Selectable().TextColor(c.Theme().Text)
	}
	ui.Text(c, locales.ChildRecordedSteps()).Bold().FontSize(12).TextColor(c.Theme().TextMuted)
	if len(m.Children) == 0 {
		ui.Text(c, locales.NoChildMessages()).TextColor(c.Theme().TextMuted)
	}
	for i, child := range m.Children {
		key := a.ID + "." + strconv.Itoa(i+1)
		ui.Column(c).Key(key).Gap(4).Padding(8).Radius(8).Background(c.Theme().Surface).Children(func() {
			if child.Tool == nil {
				ui.Text(c, child.Text).Selectable().TextColor(c.Theme().Text)
				return
			}
			ui.Text(c, child.Tool.Name).Bold().TextColor(c.Theme().Text)
			readOutput(c, &v.open, "input/"+key, pretty(child.Tool.Input))
			activityResult(c, v, workbench.Activity{ID: key, Message: child})
		})
	}
	activityResult(c, v, a)
}

func (s *Shell) commandDetail(c *ui.Context, v *sessionView, a workbench.Activity) {
	tool := a.Message.Tool
	var cmd struct{ Command, Cwd string }
	_ = json.Unmarshal(tool.Input, &cmd)
	if cmd.Command == "" {
		cmd.Command = pretty(tool.Input)
	}
	ui.Text(c, cmd.Command).Font("Menlo").Selectable().TextColor(c.Theme().Text)
	if cmd.Cwd != "" {
		ui.Text(c, cmd.Cwd).Selectable().TextColor(c.Theme().TextMuted)
	} else {
		ui.Text(c, locales.UnknownCommandDir()).TextColor(c.Theme().TextMuted)
	}
	if tool.ExitCode != nil {
		ui.Text(c, locales.CommandExit(strconv.Itoa(*tool.ExitCode))).TextColor(c.Theme().TextMuted)
	}
	activityResult(c, v, a)
}

func activityResult(c *ui.Context, v *sessionView, a workbench.Activity) {
	tool := a.Message.Tool
	label := locales.ToolResult()
	if tool.Truncated {
		label = locales.ToolTruncated(label)
	}
	ui.Text(c, label).Bold().FontSize(12).TextColor(c.Theme().TextMuted)
	if tool.Output != "" {
		readOutput(c, &v.open, "inspector/"+a.ID, tool.Output)
	} else if tool.Done {
		ui.Text(c, locales.CallEmptyOutput()).TextColor(c.Theme().TextMuted)
	} else {
		ui.Text(c, locales.CallNoResult()).TextColor(c.Theme().TextMuted)
	}
}
