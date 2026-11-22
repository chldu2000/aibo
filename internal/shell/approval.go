package shell

import (
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
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
		return "审批：未处理，轮次已结束"
	case a.Answer == nil:
		return ""
	case a.Note != "":
		return "审批：" + a.Answer.Label + "（" + a.Note + "）"
	}
	return "审批：" + a.Answer.Label
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
			s.notice = "审批失败：" + err.Error()
		}
	}
	ui.Column(c).Key("approval-"+a.ID).Label("审批卡片："+a.Title).MinWidth(0).Gap(8).Padding(10, 12).Radius(14).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.22))}).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "需要审批 · "+a.Title).Bold().TextColor(t.Text).MaxLines(1).Shrink(1)
			if a.Outside {
				ui.Text(c, "写入其他工作区").FontSize(11).Bold().TextColor(t.Background).Padding(1, 6).Radius(4).Background(t.Warning).NoWrap()
			}
		})
		if a.Command != "" {
			longText(c, a.Command, 160)
		}
		if a.Cwd != "" {
			ui.Text(c, "工作目录："+a.Cwd).FontSize(11).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().Tooltip(oneLine(a.Cwd, 300))
		}
		if a.Reason != "" {
			ui.Text(c, a.Reason).FontSize(12).TextColor(t.TextMuted).MaxLines(6)
		}
		if len(a.Paths) > 0 && a.Diff == "" {
			paths := strings.Join(a.Paths, "、")
			ui.Text(c, "涉及："+paths).FontSize(11).TextColor(t.TextMuted).MaxLines(2).TruncateMiddle().Tooltip(oneLine(paths, 300))
		}
		if a.Diff != "" {
			diffView(c, a.Diff)
		}
		if len(a.Input) > 0 && a.Command == "" && a.Diff == "" {
			longText(c, pretty(a.Input), 200)
		}
		switch {
		case st.confirming:
			o := option(a, agent.AllowAlways)
			ui.Text(c, "将写入 "+o.Where+"，以后同类操作不再询问。确定吗？").FontSize(12).TextColor(t.Text)
			allows(c, o)
			ui.Row(c).Gap(6).Children(func() {
				if ui.PrimaryButton(c, "确定永久允许").Clicked() {
					answer(o, "")
				}
				if ui.Button(c, "取消").Clicked() {
					st.confirming = false
				}
			})
		case st.denying:
			ui.TextInput(c, &st.note).Placeholder("说明拒绝的原因（可选），会告诉 Agent").Label("拒绝说明").AutoFocus()
			ui.Row(c).Gap(6).Children(func() {
				if ui.PrimaryButton(c, "确定拒绝").Clicked() {
					answer(option(a, agent.Deny), st.note)
				}
				if ui.Button(c, "取消").Clicked() {
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
						if ui.PrimaryButton(c, o.Label).Clicked() {
							answer(o, "")
						}
					case agent.AllowAlways:
						if ui.Button(c, o.Label+"…").Tooltip("写入 " + o.Where + "：" + oneLine(strings.Join(o.Detail, "；"), 200)).Clicked() {
							st.confirming = true
						}
					case agent.Deny:
						if ui.Button(c, o.Label+"…").Clicked() {
							st.denying = true
						}
					case agent.AllowSession:
						b := ui.Button(c, o.Label)
						if len(o.Detail) > 0 {
							b.Tooltip("将允许：" + oneLine(strings.Join(o.Detail, "；"), 200))
						}
						if b.Clicked() {
							answer(o, "")
						}
					default:
						if ui.Button(c, o.Label).Clicked() {
							answer(o, "")
						}
					}
				}
			})
			if hasDetail(a) {
				ui.Collapsible(c, "查看将允许的规则", &st.rules, func() {
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
	if len(o.Detail) == 0 {
		return
	}
	t := c.Theme()
	ui.Text(c, o.Label+"：").FontSize(11).TextColor(t.TextMuted)
	longText(c, strings.Join(o.Detail, "\n"), 120)
}

func hasDetail(a *model.Approval) bool {
	for _, o := range a.Options {
		if (o.Kind == agent.AllowSession || o.Kind == agent.AllowAlways) && len(o.Detail) > 0 {
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
				ui.Text(c, "……（只显示前 400 行）").FontSize(11).TextColor(t.TextMuted)
			}
		})
	})
}
