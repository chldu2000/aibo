package shell

import (
	"github.com/chldu2000/aibo/locales"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// running counts a session's tool calls still running that run terminal
// processes, and subagents: a subagent's own calls too.
func running(msgs []model.Message) (terminals, subagents int) {
	var count func(ms []model.Message)
	count = func(ms []model.Message) {
		for _, m := range ms {
			if m.Kind != model.ToolCall || m.Tool == nil || m.State != model.Streaming {
				continue
			}
			switch workbench.ActivityOf(m.Tool.Name) {
			case workbench.Commands:
				terminals++
			case workbench.Delegations:
				subagents++
			}
			count(m.Children)
		}
	}
	count(msgs)
	return terminals, subagents
}

// chip is a badge in tinted glass, its text and symbol in the theme's
// color, so that it reads in the light and the dark.
func chip(c *ui.Context, symbol, text, label string, tint ui.Color) ui.Element {
	t := c.Theme()
	return ui.Row(c).Gap(6).Padding(5, 10).Radius(14).AlignItems(ui.Center).Label(label).Material(glass.Glass{Tint: tinted(c, tint)}).Children(func() {
		icon(c, symbol).Size(12).Color(t.Text)
		ui.Text(c, text).FontSize(12).TextColor(t.Text)
	})
}

// Tints of the badges: blue for processes, purple for subagents, orange
// for what waits on the user, green for references.
var (
	tintTerminal = ui.RGBA(40, 120, 255, 0.55)
	tintSubagent = ui.RGBA(150, 80, 255, 0.55)
	tintApproval = ui.RGBA(255, 150, 0, 0.6)
	tintRefs     = ui.RGBA(20, 170, 120, 0.55)
)

// badges are above the composer: how the session runs, each hidden at
// zero. What can be done with the session is in the header.
func (s *Shell) badges(c *ui.Context, x model.Session, v *sessionView) {
	st := s.wb.Status(x.ID)
	terminals, subagents := running(v.msgs)
	refs := s.wb.Received(x.ID)
	ui.Row(c).Gap(6).AlignItems(ui.Center).Wrap().Children(func() {
		if terminals > 0 {
			if chip(c, "terminal", locales.BadgeTerminals(terminals), locales.BadgeTerminalsLabel(), tintTerminal).Clicked() {
				s.openActivities(x.ID, workbench.Commands, true)
			}
		}
		if subagents > 0 {
			if chip(c, "person.2", locales.BadgeSubagents(subagents), locales.BadgeSubagentsLabel(), tintSubagent).Clicked() {
				s.openActivities(x.ID, workbench.Delegations, true)
			}
		}
		if st.Approvals > 0 {
			chip(c, "exclamationmark.shield", locales.BadgeApprovals(st.Approvals), locales.BadgeApprovalsLabel(), tintApproval)
		}
		if refs > 0 {
			chip(c, "paperclip", locales.BadgeRefs(refs), locales.BadgeRefsLabel(), tintRefs)
		}
	})
}
