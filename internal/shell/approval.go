package shell

import (
	"github.com/chldu2000/aibo/locales"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

// approvalUI is what an approval card is in the middle of: confirming a
// permanent rule, or writing why it denies.
type approvalUI struct {
	confirming bool
	denying    bool
	note       string
	// rules is set while the rules the options allow show.
	rules bool
}

func (s *Shell) approvalState(id string) *approvalUI {
	if s.approvals == nil {
		s.approvals = map[string]*approvalUI{}
	}
	st, ok := s.approvals[id]
	if !ok {
		st = &approvalUI{}
		s.approvals[id] = st
	}
	return st
}

// answered is an approval's answer in one line.
func answered(a *model.Approval) string {
	switch {
	case a.Expired:
		return locales.AnswerExpired()
	case a.Answer == nil:
		return ""
	case a.Note != "":
		return locales.AnswerWithNote(optionLabel(a.Answer.Kind), a.Note)
	}
	return locales.Answer(optionLabel(a.Answer.Kind))
}

// optionLabel says what an answer does, short enough for a button.
func optionLabel(k agent.OptionKind) string {
	switch k {
	case agent.AllowOnce:
		return locales.OptionAllowOnce()
	case agent.AllowSession:
		return locales.OptionAllowSession()
	case agent.AllowAlways:
		return locales.OptionAllowAlways()
	case agent.Deny:
		return locales.OptionDeny()
	case agent.DenyStop:
		return locales.OptionDenyStop()
	}
	return string(k)
}

// approvalTitle says what a request asks for: what requests kept before
// Action say as they are.
func approvalTitle(a *model.Approval) string {
	switch a.Action {
	case agent.ActionCommand:
		return locales.ActionCommand()
	case agent.ActionEdit:
		return locales.ActionEdit()
	case agent.ActionPlan:
		return locales.ActionPlan()
	case agent.ActionMCP:
		return locales.ActionMCP(a.Tool)
	case agent.ActionTool:
		return locales.ActionTool(a.Tool)
	}
	return a.Title
}

// grants say what an option allows, one line for each rule: what
// answers kept before Grants say as they are.
func grants(o agent.ApprovalOption) []string {
	if len(o.Grants) == 0 {
		return o.Detail
	}
	out := make([]string, len(o.Grants))
	for i, g := range o.Grants {
		out[i] = grantText(g)
	}
	return out
}

// approvalCard asks the user, in orange-tinted glass, to answer an
// approval request with one of the Agent's own options.
func (s *Shell) approvalCard(c *ui.Context, sessionID string, a *model.Approval) {
	t := c.Theme()
	if !a.Pending() {
		ui.Text(c, answered(a)).FontSize(11).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle()
		return
	}
	st := s.approvalState(a.ID)
	answer := func(o agent.ApprovalOption, note string) {
		if err := s.wb.Approve(sessionID, a.ID, o.ID, note); err != nil {
			s.notice = s.failed(locales.ApproveFailed, err)
		}
	}
	x, _ := s.wb.Session(sessionID)
	where := func(o agent.ApprovalOption) string {
		if o.Where != "" {
			return o.Where
		}
		return locales.AgentRules(s.agentName(x.Agent))
	}
	title := approvalTitle(a)
	ui.Column(c).Key("approval-"+a.ID).Label(locales.ApprovalCard(title)).MinWidth(0).Gap(8).Padding(10, 12).Radius(14).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.22))}).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Text(c, locales.NeedsApproval(title)).Bold().TextColor(t.Text).MaxLines(1).Shrink(1)
			if a.Outside {
				ui.Text(c, locales.WritesElsewhere()).FontSize(11).Bold().TextColor(t.Background).Padding(1, 6).Radius(4).Background(t.Warning).NoWrap()
			}
		})
		if a.Command != "" {
			longText(c, a.Command, 160)
		}
		if a.Cwd != "" {
			ui.Text(c, locales.WorkingDir(a.Cwd)).FontSize(11).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().Tooltip(oneLine(a.Cwd, 300))
		}
		if a.Reason != "" {
			ui.Text(c, a.Reason).FontSize(12).TextColor(t.TextMuted).MaxLines(6)
		}
		if a.WriteRoot != "" {
			ui.Text(c, locales.WriteRoot(a.WriteRoot)).FontSize(12).TextColor(t.TextMuted).MaxLines(2)
		}
		if len(a.Paths) > 0 && a.Diff == "" {
			paths := strings.Join(a.Paths, locales.ListSep())
			ui.Text(c, locales.Touches(paths)).FontSize(11).TextColor(t.TextMuted).MaxLines(2).TruncateMiddle().Tooltip(oneLine(paths, 300))
		}
		if a.Diff != "" {
			diffView(c, a.Diff)
		}
		if a.Plan != "" {
			// The plan to act on, as the Agent wrote it.
			ui.Scroll(c).MaxHeight(320).MinWidth(0).Radius(8).Background(t.Surface).Children(func() {
				ui.Column(c).Padding(8, 10).Children(func() {
					markdown.View(c, a.Plan, &s.md)
				})
			})
		}
		if len(a.Input) > 0 && a.Command == "" && a.Diff == "" && a.Plan == "" {
			longText(c, pretty(a.Input), 200)
		}
		switch {
		case st.confirming:
			o := option(a, agent.AllowAlways)
			ui.Text(c, locales.ConfirmAlways(where(o))).FontSize(12).TextColor(t.Text)
			allows(c, o)
			ui.Row(c).Gap(6).Children(func() {
				if ui.PrimaryButton(c, locales.ConfirmAlwaysButton()).Clicked() {
					answer(o, "")
				}
				if ui.Button(c, locales.Cancel()).Clicked() {
					st.confirming = false
				}
			})
		case st.denying:
			ui.TextInput(c, &st.note).Placeholder(locales.DenyPlaceholder()).Label(locales.DenyNote()).AutoFocus()
			ui.Row(c).Gap(6).Children(func() {
				if ui.PrimaryButton(c, locales.ConfirmDeny()).Clicked() {
					answer(option(a, agent.Deny), st.note)
				}
				if ui.Button(c, locales.Cancel()).Clicked() {
					st.denying = false
				}
			})
		default:
			// The buttons say what they do; what they allow shows apart,
			// as long as it is.
			ui.Row(c).Gap(6).Wrap().Children(func() {
				for _, o := range a.Options {
					switch o.Kind {
					case agent.AllowOnce:
						if ui.PrimaryButton(c, optionLabel(o.Kind)).Clicked() {
							answer(o, "")
						}
					case agent.AllowAlways:
						if ui.Button(c, locales.OptionMore(optionLabel(o.Kind))).Tooltip(locales.AlwaysTip(where(o), oneLine(strings.Join(grants(o), locales.RuleSep()), 200))).Clicked() {
							st.confirming = true
						}
					case agent.Deny:
						if ui.Button(c, locales.OptionMore(optionLabel(o.Kind))).Clicked() {
							st.denying = true
						}
					case agent.AllowSession:
						b := ui.Button(c, optionLabel(o.Kind))
						if g := grants(o); len(g) > 0 {
							b.Tooltip(locales.SessionTip(oneLine(strings.Join(g, locales.RuleSep()), 200)))
						}
						if b.Clicked() {
							answer(o, "")
						}
					default:
						if ui.Button(c, optionLabel(o.Kind)).Clicked() {
							answer(o, "")
						}
					}
				}
			})
			if hasDetail(a) {
				ui.Collapsible(c, locales.ShowRules(), &st.rules, func() {
					ui.Column(c).Gap(6).MinWidth(0).Children(func() {
						for _, o := range a.Options {
							if o.Kind == agent.AllowSession || o.Kind == agent.AllowAlways {
								allows(c, o)
							}
						}
					})
				})
			}
		}
	})
}

// allows shows what option o allows, rule by rule, however long.
func allows(c *ui.Context, o agent.ApprovalOption) {
	g := grants(o)
	if len(g) == 0 {
		return
	}
	t := c.Theme()
	ui.Text(c, locales.LabelColon(optionLabel(o.Kind))).FontSize(11).TextColor(t.TextMuted)
	longText(c, strings.Join(g, "\n"), 120)
}

func hasDetail(a *model.Approval) bool {
	for _, o := range a.Options {
		if (o.Kind == agent.AllowSession || o.Kind == agent.AllowAlways) && len(grants(o)) > 0 {

			return true
		}
	}
	return false
}

// longText shows text that may be as long as a command, in monospace, in
// a box at most maxHeight tall that scrolls: it never widens the card.
func longText(c *ui.Context, text string, maxHeight float32) {
	t := c.Theme()
	ui.Scroll(c).MaxHeight(maxHeight).MinWidth(0).Radius(8).Background(t.Surface).Children(func() {
		ui.Text(c, text).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable().Padding(6, 8)
	})
}

func option(a *model.Approval, kind agent.OptionKind) agent.ApprovalOption {
	for _, o := range a.Options {
		if o.Kind == kind {
			return o
		}
	}
	return agent.ApprovalOption{}
}

// diffView shows a unified diff, its added and removed lines colored.
func diffView(c *ui.Context, diff string) {
	t := c.Theme()
	lines := strings.Split(diff, "\n")
	const most = 400
	cut := len(lines) > most
	if cut {
		lines = lines[:most]
	}
	ui.Scroll(c).MaxHeight(280).Radius(8).Background(t.Surface).Children(func() {
		ui.Column(c).Padding(6, 8).Children(func() {
			for i, l := range lines {
				color := t.Text
				switch {
				case strings.HasPrefix(l, "+++") || strings.HasPrefix(l, "---") || strings.HasPrefix(l, "@@"):
					color = t.TextMuted
				case strings.HasPrefix(l, "+"):
					color = t.Success
				case strings.HasPrefix(l, "-"):
					color = t.Danger
				}
				ui.Text(c, l).Key(i).Font("Menlo").FontSize(11).TextColor(color).NoWrap()
			}
			if cut {
				ui.Text(c, locales.DiffCut()).FontSize(11).TextColor(t.TextMuted)
			}
		})
	})
}
