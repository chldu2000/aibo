package shell

import (
	"fmt"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// levels are the approval levels in the order shown, with what they mean.
var levels = []struct {
	level      agent.ApprovalLevel
	name, what string
}{
	{agent.AskAlways, "每次询问", "执行命令、修改文件前都先问你"},
	{agent.AcceptEdits, "自动接受工作区内修改", "工作区内的文件修改不再询问，其余照常询问"},
	{agent.FullAuto, "全部自动", "所有操作都不再询问，包括工作区以外"},
}

func levelName(l agent.ApprovalLevel) string {
	for _, x := range levels {
		if x.level == l {
			return x.name
		}
	}
	return levels[0].name
}

// levelState is the approval control's popover.
type levelState struct {
	open bool
	// confirming is set while full auto waits for a second click.
	confirming bool
}

// levelControl is the composer's approval control: the session's level,
// which a click opens to change, with the rules allowed for the session.
func (s *Shell) levelControl(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := &s.level
	b := ui.Row(c).Gap(4).Padding(4, 8).Radius(8).AlignItems(ui.Center).Label("审批档位：" + levelName(x.Level)).Tooltip("审批档位：点击更改").Children(func() {
		symbol := "checkmark.shield"
		if x.Level == agent.FullAuto {
			symbol = "exclamationmark.shield"
		}
		sfsymbols.Symbol(c, symbol).Size(13).Color(t.TextMuted)
		ui.Text(c, levelName(x.Level)).FontSize(12).TextColor(t.TextMuted)
		if n := len(x.Rules); n > 0 {
			ui.Text(c, fmt.Sprintf("· %d 条规则", n)).FontSize(12).TextColor(t.TextMuted)
		}
	})
	if b.Hovered() {
		b.Background(t.SurfaceHover)
	}
	if b.Clicked() {
		st.open, st.confirming = !st.open, false
	}
	ui.Popover(c, b, &st.open, func() {
		ui.Column(c).Width(380).Gap(8).Padding(14).Children(func() {
			ui.Text(c, "审批档位").Bold().TextColor(t.Text)
			if st.confirming {
				ui.Text(c, "全部自动后，Agent 执行命令、修改文件（包括工作区以外）都不再询问。确定吗？").FontSize(12).TextColor(t.Text)
				ui.Row(c).Gap(6).Children(func() {
					if ui.PrimaryButton(c, "确定全部自动").Clicked() {
						s.setLevel(x.ID, agent.FullAuto)
						st.open, st.confirming = false, false
					}
					if ui.Button(c, "取消").Clicked() {
						st.confirming = false
					}
				})
				return
			}
			for _, l := range levels {
				row := pickRow(c, string(l.level), l.name, func() {
					symbol := "circle"
					if l.level == x.Level {
						symbol = "checkmark.circle.fill"
					}
					sfsymbols.Symbol(c, symbol).Size(14).Color(t.Accent)
					ui.Column(c).Grow(1).Children(func() {
						ui.Text(c, l.name).TextColor(t.Text)
						ui.Text(c, l.what).FontSize(11).TextColor(t.TextMuted)
					})
				})
				if row.Clicked() && l.level != x.Level {
					if l.level == agent.FullAuto {
						st.confirming = true
					} else {
						s.setLevel(x.ID, l.level)
						st.open = false
					}
				}
			}
			ui.Text(c, "本会话内始终允许").Bold().TextColor(t.Text).Padding(8, 0, 0)
			if len(x.Rules) == 0 {
				ui.Text(c, "无").FontSize(12).TextColor(t.TextMuted)
			}
			for i, r := range x.Rules {
				s.ruleRow(c, x.ID, i, r)
			}
			if len(x.Rules) > 0 {
				ui.Text(c, "撤销后，Agent 会在空闲时重新启动，以便不再带上这条规则。").FontSize(11).TextColor(t.TextMuted)
			}
			if len(x.ReadDirs) > 0 {
				ui.Text(c, "可读的源工作区").Bold().TextColor(t.Text).Padding(8, 0, 0)
				for i, d := range x.ReadDirs {
					ui.Text(c, d+"（只读）").Key(i).Font("Menlo").FontSize(11).TextColor(t.Text)
				}
				ui.Text(c, "收到别的工作区的引用后，Agent 可以读那里的文件，但不能修改。").FontSize(11).TextColor(t.TextMuted)
			}
		})
	})
}

func (s *Shell) setLevel(id string, l agent.ApprovalLevel) {
	if err := s.wb.SetLevel(id, l); err != nil {
		s.notice = "更改审批档位失败：" + err.Error()
	}
}

// ruleRow is a rule the session allows, in one line however long, its
// middle cut and the whole of it on hover, with its revoke button always
// in sight.
func (s *Shell) ruleRow(c *ui.Context, sessionID string, i int, r agent.Rule) {
	t := c.Theme()
	ui.Row(c).Key(i).Gap(6).AlignItems(ui.Center).MinWidth(0).Children(func() {
		ui.Text(c, r.Label).FontSize(12).TextColor(t.Text).MaxLines(1).TruncateMiddle().Tooltip(oneLine(r.Label, 300)).Grow(1).Shrink(1).MinWidth(0)
		if ui.Button(c, "撤销").Label("撤销 " + oneLine(r.Label, 200)).Shrink(0).Clicked() {
			if err := s.wb.RevokeRule(sessionID, i); err != nil {
				s.notice = err.Error()
			}
		}
	})
}
