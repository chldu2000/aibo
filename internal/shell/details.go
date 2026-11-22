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
	// confirming is a dangerous mode waiting for a second click.
	confirming string
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
			ui.Column(c).Grow(1).MinWidth(0).Gap(2).Children(v)
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
				text(s.agentName(x.Agent))
			})
			kv("模型", func() {
				u := s.using(x)
				line := u.name
				if u.effort != "" {
					line += " · 推理强度 " + u.effort
				}
				text(line)
				if st.Running {
					ui.Text(c, "这一轮结束后可以在输入框底部更换").FontSize(11).TextColor(t.TextMuted)
				}
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
			kv("权限模式", func() {
				s.detailsMode(c, x)
			})
			kv("始终允许", func() {
				if len(x.Rules) == 0 {
					text("无")
				}
				for i, r := range x.Rules {
					s.ruleRow(c, x.ID, i, r)
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

// detailsMode chooses the permission mode, among those that can be, a
// dangerous one after asking again.
func (s *Shell) detailsMode(c *ui.Context, x model.Session) {
	if s.modeConfirm(c, x, &s.detail.confirming) || s.detail.confirming != "" {
		return
	}
	cur := s.modeOf(x)
	var names []string
	byName := map[string]agent.PermissionMode{}
	for _, m := range s.modesOf(x.Agent) {
		if m.Unavailable == "" {
			names = append(names, m.Name)
			byName[m.Name] = m
		}
	}
	name := cur.Name
	if len(names) == 0 {
		ui.Text(c, name).FontSize(12).TextColor(c.Theme().Text)
		return
	}
	if ui.Select(c, &name, names).Label("权限模式（选择）").Changed() {
		if m := byName[name]; m.Risk == agent.Danger {
			s.detail.confirming = m.ID
		} else {
			s.setMode(x.ID, m.ID)
		}
	}
	ui.Text(c, cur.Description).FontSize(11).TextColor(c.Theme().TextMuted)
}
