package shell

import (
	"fmt"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// detailsUI is the session details panel.
type detailsUI struct {
	open bool
	// confirming is set while full auto waits for a second click.
	confirming bool
}

// details is the session details panel, floating in glass from the
// header: everything about the session, and what can be done to it.
func (s *Shell) details(c *ui.Context, x model.Session) {
	if !s.detail.open {
		return
	}
	t := c.Theme()
	st := s.wb.Status(x.ID)
	ws := s.workspaceOf(x)
	kv := func(k string, v func()) {
		ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
			ui.Text(c, k).FontSize(12).TextColor(t.TextMuted).Width(84)
			ui.Column(c).Grow(1).Gap(2).Children(v)
		})
	}
	text := func(s string) { ui.Text(c, s).FontSize(12).TextColor(t.Text).Selectable() }
	ui.Scroll(c).Absolute().Top(70).Right(16).Width(400).MaxHeight(560).Radius(18).Material(glass.Glass{}).Children(func() {
		ui.Column(c).Gap(12).Padding(16).Children(func() {
			ui.Row(c).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "会话详情").Bold().TextColor(t.Text).Grow(1)
				if iconButton(c, "xmark", "关闭会话详情").Clicked() {
					s.detail.open = false
				}
			})
			kv("Agent", func() {
				m := x.Model
				if m == "" {
					m = "默认模型"
				}
				text(s.agentName(x.Agent) + " · " + m)
			})
			kv("工作区", func() {
				text(ws.Path)
				if ws.Missing {
					ui.Text(c, "目录不存在").FontSize(11).TextColor(t.Warning)
				}
			})
			kv("原生会话", func() {
				var ids []string
				for _, id := range x.NativeIDs {
					if id != "" {
						ids = append(ids, id)
					}
				}
				switch {
				case len(ids) == 0:
					text("尚未开始")
				default:
					text(ids[len(ids)-1])
					if len(ids) > 1 {
						ui.Text(c, fmt.Sprintf("第 %d 个（之前的已无法续接）", len(ids))).FontSize(11).TextColor(t.TextMuted)
					}
				}
				state := "进程未运行，发消息时续接"
				if st.Connected {
					state = "进程运行中"
				}
				ui.Text(c, state).FontSize(11).TextColor(t.TextMuted)
			})
			kv("审批档位", func() {
				s.detailsLevel(c, x)
			})
			kv("始终允许", func() {
				if len(x.Rules) == 0 {
					text("无")
				}
				for i, r := range x.Rules {
					ui.Row(c).Key(i).Gap(6).AlignItems(ui.Center).Children(func() {
						ui.Text(c, r.Label).FontSize(12).TextColor(t.Text).Grow(1)
						if ui.Button(c, "撤销").Label("撤销 " + r.Label).Clicked() {
							if err := s.wb.RevokeRule(x.ID, i); err != nil {
								s.notice = err.Error()
							}
						}
					})
				}
			})
			kv("可读的源工作区", func() {
				if len(x.ReadDirs) == 0 {
					text("无")
				}
				for i, d := range x.ReadDirs {
					ui.Text(c, d+"（只读）").Key(i).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable()
				}
			})
			ui.Row(c).Gap(6).Wrap().Children(func() {
				if ui.Button(c, "压缩上下文").Disabled(st.Running).Clicked() {
					if err := s.wb.Compact(x.ID); err != nil {
						s.notice = err.Error()
					}
				}
				if ui.Button(c, "重命名…").Clicked() {
					s.side.renaming, s.side.newTitle = x.ID, x.Title
				}
				archive := "归档"
				if x.Archived {
					archive = "取消归档"
				}
				if ui.Button(c, archive).Clicked() {
					if err := s.wb.SetArchived(x.ID, !x.Archived); err != nil {
						s.notice = err.Error()
					}
				}
				if ui.Button(c, "删除…").TextColor(t.Danger).Clicked() {
					s.side.deleting = x.ID
				}
			})
		})
	})
}

// detailsLevel chooses the approval level, full auto after asking again.
func (s *Shell) detailsLevel(c *ui.Context, x model.Session) {
	t := c.Theme()
	if s.detail.confirming {
		ui.Text(c, "全部自动后，Agent 执行命令、修改文件（包括工作区以外）都不再询问。确定吗？").FontSize(12).TextColor(t.Text)
		ui.Row(c).Gap(6).Children(func() {
			if ui.PrimaryButton(c, "确定全部自动").Clicked() {
				s.setLevel(x.ID, agent.FullAuto)
				s.detail.confirming = false
			}
			if ui.Button(c, "取消").Clicked() {
				s.detail.confirming = false
			}
		})
		return
	}
	i := 0
	names := make([]string, len(levels))
	// Short names: the panel is narrow. What the level means is under them.
	short := map[agent.ApprovalLevel]string{agent.AcceptEdits: "自动改工作区", agent.FullAuto: "全部自动"}
	for k, l := range levels {
		names[k] = l.name
		if n, ok := short[l.level]; ok {
			names[k] = n
		}
		if l.level == x.Level {
			i = k
		}
	}
	if ui.Segmented(c, &i, names...).Label("审批档位（选择）").Changed() {
		if levels[i].level == agent.FullAuto {
			s.detail.confirming = true
		} else {
			s.setLevel(x.ID, levels[i].level)
		}
	}
	ui.Text(c, levels[i].what).FontSize(11).TextColor(c.Theme().TextMuted)
}
