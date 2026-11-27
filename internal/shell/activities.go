package shell

import (
	"encoding/json"
	"strconv"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

func (s *Shell) openActivities(id string, kind workbench.ActivityKind, fromBadge bool) {
	s.detail.open = true
	s.showPage(string(kind))
	s.detail.selected, s.detail.confirming = "", ""
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
		tool.Approval.Answer.Kind.Denies() {
		return locales.CallDeclined()
	}
	switch {
	case a.Active:
		return locales.CallActive()
	case m.State == model.Interrupted && !tool.Done:
		// The parent turn stopped reporting. Its command or child may
		// still be running independently.
		return locales.CallUnknown()
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

// callTone is the symbol and color of a call's state, as callState says
// it: running, returned, failed, declined, or not known.
func callTone(c *ui.Context, a workbench.Activity) (string, ui.Color) {
	t := c.Theme()
	m, tool := a.Message, a.Message.Tool
	switch {
	case tool.Declined || tool.Approval != nil && tool.Approval.Answer != nil &&
		tool.Approval.Answer.Kind.Denies():
		return "xmark.circle", t.TextMuted
	case a.Active:
		return "circle.dotted", t.Accent
	case m.State == model.Interrupted:
		return "questionmark.circle", t.Warning
	case tool.IsError:
		return "exclamationmark.circle", t.Danger
	case tool.Done:
		return "checkmark.circle", t.Success
	}
	return "questionmark.circle", t.TextMuted
}

// callStatus is a call's state in a line, its symbol before.
func callStatus(c *ui.Context, a workbench.Activity) {
	symbol, ink := callTone(c, a)
	ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		icon(c, symbol).Size(13).Color(ink)
		ui.Text(c, callState(a)).FontSize(12).TextColor(c.Theme().Text)
	})
}

// emptyState stands for a page with nothing to show: a symbol and a line,
// in the middle.
func emptyState(c *ui.Context, symbol, text string) {
	t := c.Theme()
	ui.Column(c).Gap(8).Padding(40, 16).AlignItems(ui.Center).Children(func() {
		icon(c, symbol).Size(24).Color(t.TextMuted)
		ui.Text(c, text).FontSize(12).TextColor(t.TextMuted).TextAlign(ui.Center)
	})
}

func (s *Shell) activityPage(c *ui.Context, x model.Session) {
	t := c.Theme()
	v := s.view(x.ID)
	kind := workbench.ActivityKind(s.detail.page)
	items := workbench.Activities(v.msgs, kind)
	for _, a := range items {
		if a.ID == s.detail.selected {
			ui.Column(c).Gap(12).Children(func() {
				callStatus(c, a)
				if kind == workbench.Delegations {
					s.delegationDetail(c, x.ID, v, a)
				} else {
					s.commandDetail(c, x.ID, v, a)
				}
			})
			return
		}
	}
	s.detail.selected = ""
	if len(items) == 0 {
		symbol := "terminal"
		if kind == workbench.Delegations {
			symbol = "person.2"
		}
		emptyState(c, symbol, locales.NoActivities())
		return
	}
	ui.Column(c).Gap(1).Children(func() {
		for _, a := range items {
			title := gist(a.Message.Tool.Input)
			label := "#" + a.ID + " · " + title
			symbol, ink := callTone(c, a)
			row := pickRow(c, a.ID, label, func() {
				ui.Box(c).Padding(2, 0, 0).AlignSelf(ui.Start).Children(func() {
					icon(c, symbol).Size(14).Color(ink)
				})
				ui.Column(c).Gap(2).MinWidth(0).Grow(1).Children(func() {
					ui.Text(c, title).FontSize(13).MaxLines(2).TextColor(t.Text)
					state := callState(a)
					if kind == workbench.Commands && s.wb.TerminalState(x.ID, a.Message.Tool) == workbench.TerminalListed {
						state += " · " + locales.BackgroundListed()
					}
					ui.Text(c, "#"+a.ID+" · "+state).FontSize(11).TextColor(t.TextMuted).MaxLines(1)
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
func (s *Shell) delegationDetail(c *ui.Context, id string, v *sessionView, a workbench.Activity) {
	m := a.Message
	if h := s.detail.history; h != nil {
		s.childPage(c, h)
		if h.err == nil {
			return
		}
	} else if m.Tool.ChildThread != "" && m.Tool.NativeThread != "" {
		if ui.Button(c, locales.ChildHistoryOpen()).Clicked() {
			h := &childHistoryView{session: id, activity: a.ID, seen: map[[2]string]bool{}, cursors: map[string]bool{}}
			s.detail.history = h
			s.loadChildPage(h)
		}
	}
	var task struct{ Description, Prompt string }
	_ = json.Unmarshal(m.Tool.Input, &task)
	if task.Description != "" {
		ui.Text(c, task.Description).Bold().FontSize(13).TextColor(c.Theme().Text)
	}
	if task.Prompt != "" {
		ui.Text(c, task.Prompt).FontSize(12).Selectable().TextColor(c.Theme().Text).Padding(10, 12).Radius(10).Background(veil(c, 0.035))
	}
	sectionTitle(c, locales.ChildRecordedSteps())
	if len(m.Children) == 0 {
		ui.Text(c, locales.NoChildMessages()).FontSize(12).TextColor(c.Theme().TextMuted).Padding(0, 6)
	}
	for i, child := range m.Children {
		key := a.ID + "." + strconv.Itoa(i+1)
		ui.Column(c).Key(key).Gap(6).Padding(10, 12).Radius(10).Background(veil(c, 0.035)).Children(func() {
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

// commandDetail shows the command in a block of its own, then where it
// ran, how it ended and whether its terminal is still there.
func (s *Shell) commandDetail(c *ui.Context, id string, v *sessionView, a workbench.Activity) {
	t := c.Theme()
	tool := a.Message.Tool
	var cmd struct{ Command, Cwd string }
	_ = json.Unmarshal(tool.Input, &cmd)
	if cmd.Command == "" {
		cmd.Command = pretty(tool.Input)
	}
	ui.Text(c, cmd.Command).Font("Menlo").FontSize(12).Selectable().TextColor(t.Text).Padding(10, 12).Radius(10).Background(veil(c, 0.05))
	line := func(symbol, text string, ink ui.Color, mono bool) {
		ui.Row(c).Gap(8).Padding(0, 6).AlignItems(ui.Center).Children(func() {
			icon(c, symbol).Size(13).Color(t.TextMuted)
			tx := ui.Text(c, text).FontSize(12).TextColor(ink).Selectable().MaxLines(1).TruncateMiddle().Tooltip(text).Grow(1).MinWidth(0)
			if mono {
				tx.Font("Menlo").FontSize(11)
			}
		})
	}
	ui.Column(c).Gap(6).Children(func() {
		if cmd.Cwd != "" {
			line("folder", cmd.Cwd, t.Text, true)
		} else {
			line("folder", locales.UnknownCommandDir(), t.TextMuted, false)
		}
		if tool.ExitCode != nil {
			ink := t.Text
			if *tool.ExitCode != 0 {
				ink = t.Danger
			}
			line("number", locales.CommandExit(strconv.Itoa(*tool.ExitCode)), ink, false)
		}
		label := locales.BackgroundUnknown()
		switch s.wb.TerminalState(id, tool) {
		case workbench.TerminalListed:
			label = locales.BackgroundListed()
		case workbench.TerminalAbsent:
			label = locales.BackgroundAbsent()
		}
		line("terminal", label, t.TextMuted, false)
	})
	activityResult(c, v, a)
}

func activityResult(c *ui.Context, v *sessionView, a workbench.Activity) {
	tool := a.Message.Tool
	label := locales.ToolResult()
	if tool.Truncated {
		label = locales.ToolTruncated(label)
	}
	sectionTitle(c, label)
	if tool.Output != "" {
		readOutput(c, &v.open, "inspector/"+a.ID, tool.Output)
	} else if tool.Done {
		ui.Text(c, locales.CallEmptyOutput()).FontSize(12).TextColor(c.Theme().TextMuted).Padding(0, 6)
	} else {
		ui.Text(c, locales.CallNoResult()).FontSize(12).TextColor(c.Theme().TextMuted).Padding(0, 6)
	}
}
