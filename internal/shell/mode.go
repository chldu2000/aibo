package shell

import (
	"context"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// modes are the permission modes an Agent told, loaded once.
type modes struct {
	list    []agent.PermissionMode
	loading bool
}

// modesOf are an Agent's permission modes, loading them the first time;
// none while they load, or when it does not tell.
func (s *Shell) modesOf(kind agent.Kind) []agent.PermissionMode {
	if s.modes == nil {
		s.modes = map[agent.Kind]*modes{}
	}
	if m, ok := s.modes[kind]; ok {
		return m.list
	}
	m := &modes{loading: true}
	s.modes[kind] = m
	go func() {
		list, _ := s.wb.PermissionModes(context.Background(), kind)
		s.later(func() { m.loading, m.list = false, list })
	}()
	return nil
}

// modeOf is the session's permission mode as far as known: the one chosen,
// else the one the Agent says it is in, else its default. Its name is the
// ID when the Agent's list does not have it, "默认模式" when none is known.
func (s *Shell) modeOf(x model.Session) agent.PermissionMode {
	id := x.Mode
	if id == "" {
		id = s.wb.Status(x.ID).Mode
	}
	list := s.modesOf(x.Agent)
	for _, m := range list {
		if m.ID == id || id == "" && m.Default {
			return m
		}
	}
	if id == "" {
		return agent.PermissionMode{Name: "默认模式"}
	}
	return agent.PermissionMode{ID: id, Name: id}
}

// modeState is the composer's permission mode popover.
type modeState struct {
	open bool
	// confirming is a dangerous mode waiting for a second click.
	confirming string
}

// modeControl is the composer's permission mode: the session's, which a
// click opens to change, with the rules allowed for the session.
func (s *Shell) modeControl(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := &s.modeMenu
	cur := s.modeOf(x)
	// A dangerous mode warns here, in orange, rather than in a banner that
	// would take the messages' room for as long as it lasts.
	danger := cur.Risk == agent.Danger
	symbol, color, tip := "checkmark.shield", t.TextMuted, "权限模式：点击更改"
	if danger {
		symbol, color, tip = "exclamationmark.shield", t.Warning, cur.Name+"："+cur.Description+"。点击更改"
	}
	b := ui.Row(c).Gap(4).Padding(4, 8).Radius(8).AlignItems(ui.Center).Label("权限模式：" + cur.Name).Tooltip(tip).Children(func() {
		sfsymbols.Symbol(c, symbol).Size(13).Color(color)
		ui.Text(c, cur.Name).FontSize(12).TextColor(color)
		if n := len(x.Rules); n > 0 {
			ui.Textf(c, "· %d 条规则", n).FontSize(12).TextColor(color)
		}
	})
	switch {
	case danger && b.Hovered():
		b.Background(tinted(c, ui.RGBA(255, 150, 0, 0.28)))
	case danger:
		b.Background(tinted(c, ui.RGBA(255, 150, 0, 0.18)))
	case b.Hovered():
		b.Background(t.SurfaceHover)
	}
	if b.Clicked() {
		st.open, st.confirming = !st.open, ""
	}
	ui.Popover(c, b, &st.open, func() {
		ui.Column(c).Width(400).Gap(8).Padding(14).Children(func() {
			ui.Text(c, s.agentName(x.Agent)+" 的权限模式").Bold().TextColor(t.Text)
			if s.modeConfirm(c, x, &st.confirming) {
				st.open = false
				return
			}
			if st.confirming != "" {
				return
			}
			list := s.modesOf(x.Agent)
			if list == nil {
				ui.Text(c, "正在读取……").FontSize(12).TextColor(t.TextMuted)
			}
			for _, m := range list {
				if s.modeRow(c, m, m.ID == cur.ID) && m.ID != cur.ID {
					if m.Risk == agent.Danger {
						st.confirming = m.ID
					} else {
						s.setMode(x.ID, m.ID)
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

// modeRow is a mode to choose, under the Agent's own name, grayed with
// why when it cannot be chosen; it reports a click on one that can.
func (s *Shell) modeRow(c *ui.Context, m agent.PermissionMode, current bool) bool {
	t := c.Theme()
	children := func() {
		symbol := "circle"
		if current {
			symbol = "checkmark.circle.fill"
		}
		sfsymbols.Symbol(c, symbol).Size(14).Color(t.Accent)
		ui.Column(c).Grow(1).Children(func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				name := ui.Text(c, m.Name).TextColor(t.Text)
				if m.Risk == agent.Danger {
					name.TextColor(t.Warning)
				}
				if m.Default {
					ui.Text(c, "默认").FontSize(11).TextColor(t.TextMuted)
				}
			})
			ui.Text(c, m.Description).FontSize(11).TextColor(t.TextMuted)
			if m.Unavailable != "" {
				ui.Text(c, m.Unavailable).FontSize(11).TextColor(t.Warning)
			}
		})
	}
	if m.Unavailable != "" {
		ui.Row(c).Key(m.ID).Gap(8).Padding(6, 8).AlignItems(ui.Center).Opacity(0.5).Children(children)
		return false
	}
	return pickRow(c, m.ID, m.Name, children).Clicked()
}

// modeConfirm asks again before the dangerous mode *confirming, and
// reports whether the user went on.
func (s *Shell) modeConfirm(c *ui.Context, x model.Session, confirming *string) bool {
	if *confirming == "" {
		return false
	}
	t := c.Theme()
	m := agent.PermissionMode{ID: *confirming, Name: *confirming}
	for _, l := range s.modesOf(x.Agent) {
		if l.ID == *confirming {
			m = l
		}
	}
	ui.Text(c, m.Name+"："+m.Description+"。确定吗？").FontSize(12).TextColor(t.Text)
	done := false
	ui.Row(c).Gap(6).Children(func() {
		if ui.PrimaryButton(c, "确定切换到 "+m.Name).Clicked() {
			s.setMode(x.ID, m.ID)
			*confirming, done = "", true
		}
		if ui.Button(c, "取消").Clicked() {
			*confirming = ""
		}
	})
	return done
}

func (s *Shell) setMode(id, mode string) {
	if err := s.wb.SetMode(id, mode); err != nil {
		s.notice = "更改权限模式失败：" + err.Error()
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
