package shell

import (
	"context"
	"fmt"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// sidebarUI is the sidebar's state.
type sidebarUI struct {
	query        string
	showArchived bool
	// renaming is the session being renamed, with its new title; deleting
	// the one whose deletion waits for confirmation.
	renaming, newTitle string
	deleting           string
	// choosingModel is the Agent of the new session, its models listed,
	// for the workspace choosingAgent.
	choosingModel agent.Kind
}

// sidebar is the floating Liquid Glass sidebar: search, the workspaces
// with their sessions, and the archived ones. Fill ignores margins, so
// the gap around the glass is the outer box's padding.
func (s *Shell) sidebar(c *ui.Context) {
	t := c.Theme()
	ui.Box(c).Fill().Padding(8).Children(func() {
		ui.Column(c).Fill().Radius(16).Material(glass.Glass{Native: true}).Children(func() {
			ui.Column(c).Gap(6).Padding(40, 10, 4).Children(func() {
				ui.Row(c).Padding(0, 6, 4).AlignItems(ui.Center).Children(func() {
					ui.Text(c, "aibo").Bold().FontSize(15).TextColor(t.Text)
					ui.Spacer(c)
					if iconButton(c, "folder.badge.plus", "添加工作区").Clicked() {
						s.addWorkspace()
					}
				})
				ui.TextInput(c, &s.side.query).Placeholder("搜索会话").Label("搜索会话")
			})
			ui.Scroll(c).Grow(1).Children(func() {
				ui.Column(c).Gap(2).Padding(4, 10, 10).Children(func() {
					if s.side.query != "" {
						s.searchResults(c)
					} else {
						s.workspaceGroups(c)
					}
				})
			})
			ui.Row(c).Padding(8, 10).AlignItems(ui.Center).Children(func() {
				if iconButton(c, "gearshape", "设置（⌘,）").Clicked() {
					s.openSettings()
				}
				ui.Spacer(c)
			})
		})
	})
	s.renameDialog(c)
	s.deleteDialog(c)
}

func (s *Shell) workspaceGroups(c *ui.Context) {
	t := c.Theme()
	workspaces := s.wb.Workspaces()
	if len(workspaces) == 0 {
		ui.Column(c).Gap(10).Padding(16, 6).Children(func() {
			ui.Text(c, "还没有工作区。添加一个项目文件夹（也可以把文件夹拖进窗口），就可以在里面和 Agent 对话。").FontSize(12).TextColor(t.TextMuted)
			if ui.Button(c, "添加工作区…").Clicked() {
				s.addWorkspace()
			}
		})
	}
	sessions := s.wb.Sessions()
	for _, ws := range workspaces {
		header := ui.Row(c).Padding(10, 6, 4).Gap(6).AlignItems(ui.Center).Key(ws.ID).Children(func() {
			ui.Text(c, workspaceName(ws)).FontSize(12).Bold().TextColor(t.TextMuted).Tooltip(ws.Path).MaxLines(1).Grow(1)
			if ws.Missing {
				ui.Text(c, "目录不存在").FontSize(11).TextColor(t.Warning)
			}
			s.newSessionButton(c, ws)
		})
		header.ContextMenu(func(m *ui.Menu) {
			if m.Item("重新定位…").Chosen() {
				s.relocate(ws)
			}
			if s.opts.ShowInFinder != nil && m.Item("在 Finder 中显示").Disabled(ws.Missing).Chosen() {
				s.opts.ShowInFinder(ws.Path)
			}
			m.Separator()
			if m.Item("移除工作区（会话转为归档）").Chosen() {
				if err := s.wb.RemoveWorkspace(ws.ID); err != nil {
					s.notice = err.Error()
				}
			}
		})
		for _, x := range sessions {
			if x.WorkspaceID == ws.ID && !x.Archived {
				s.sessionRow(c, x)
			}
		}
	}
	var archived []model.Session
	for _, x := range sessions {
		if x.Archived {
			archived = append(archived, x)
		}
	}
	if len(archived) > 0 {
		label := fmt.Sprintf("已归档 · %d", len(archived))
		ui.Collapsible(c, label, &s.side.showArchived, func() {
			for _, x := range archived {
				s.sessionRow(c, x)
			}
		})
	}
}

// sessionRow is a session in the sidebar: its Agent, its title, how it
// stands; a click opens it, a right-click its menu.
func (s *Shell) sessionRow(c *ui.Context, x model.Session) {
	t := c.Theme()
	row := ui.Row(c).Key(x.ID).Gap(8).Padding(6, 8).Radius(7).AlignItems(ui.Center).Children(func() {
		agentGlyph(c, x.Agent, 18)
		ui.Text(c, sessionTitle(x)).TextColor(t.Text).MaxLines(1).Grow(1)
		s.marks(c, x)
	})
	if x.ID == s.current {
		row.Background(t.SurfacePressed)
	} else if row.Hovered() {
		row.Background(t.SurfaceHover)
	}
	if row.Clicked() {
		s.current = x.ID
	}
	row.ContextMenu(func(m *ui.Menu) {
		if m.Item("重命名…").Chosen() {
			s.side.renaming, s.side.newTitle = x.ID, x.Title
		}
		archive := "归档"
		if x.Archived {
			archive = "取消归档"
		}
		if m.Item(archive).Chosen() {
			if err := s.wb.SetArchived(x.ID, !x.Archived); err != nil {
				s.notice = err.Error()
			}
		}
		m.Separator()
		if m.Item("删除…").Chosen() {
			s.side.deleting = x.ID
		}
	})
}

// marks are how a session stands, in the sidebar: waiting for approval,
// running, needing attention, and the references it received.
func (s *Shell) marks(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := s.wb.Status(x.ID)
	switch {
	case st.Approvals > 0:
		ui.Text(c, fmt.Sprintf("待审批 %d", st.Approvals)).FontSize(11).Bold().TextColor(t.Warning)
	case st.Running:
		ui.Text(c, "运行中").FontSize(11).TextColor(t.TextMuted)
	case st.Error != "" || st.ResumeFailed != "" || st.NeedsLogin:
		ui.Text(c, "出错").FontSize(11).Bold().TextColor(t.Danger).Tooltip(firstOf(st.ResumeFailed, st.Error, "Agent 未登录"))
	}
	if n := s.wb.Received(x.ID); n > 0 {
		ui.Text(c, fmt.Sprintf("引用 %d", n)).FontSize(11).TextColor(t.TextMuted).Tooltip(fmt.Sprintf("收到 %d 个引用", n))
	}
}

func firstOf(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

// searchResults are the sessions whose titles or messages hold the
// query, archived ones too.
func (s *Shell) searchResults(c *ui.Context) {
	t := c.Theme()
	found, err := s.wb.SearchSessions(s.side.query)
	if err != nil {
		ui.Text(c, err.Error()).FontSize(12).TextColor(t.Warning)
		return
	}
	if len(found) == 0 {
		ui.Text(c, "没有找到会话").FontSize(12).TextColor(t.TextMuted).Padding(10, 6)
	}
	for _, f := range found {
		x := f.Session
		row := ui.Column(c).Key(x.ID).Gap(2).Padding(6, 8).Radius(7).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				agentGlyph(c, x.Agent, 16)
				ui.Text(c, sessionTitle(x)).TextColor(t.Text).MaxLines(1).Grow(1)
				if x.Archived {
					ui.Text(c, "已归档").FontSize(11).TextColor(t.TextMuted)
				}
			})
			if f.Snippet != "" {
				ui.Text(c, f.Snippet).FontSize(11).TextColor(t.TextMuted).MaxLines(2)
			}
		})
		if row.Hovered() {
			row.Background(t.SurfaceHover)
		}
		if row.Clicked() {
			s.current = x.ID
		}
	}
}

// newSessionButton is a workspace's "+": the Agent, then its model, of
// the new session.
func (s *Shell) newSessionButton(c *ui.Context, ws model.Workspace) {
	t := c.Theme()
	plus := iconButton(c, "plus", "在 "+workspaceName(ws)+" 新建会话")
	if plus.Clicked() {
		all := s.wb.Agents()
		switch {
		case len(all) == 1 && s.opts.Agents == nil && !s.wb.TellsModels(all[0].Kind):
			// Nothing to choose.
			s.newSession(ws, all[0].Kind, "")
		case len(all) == 1 && s.opts.Agents == nil:
			s.choosingAgent, s.side.choosingModel = ws.ID, all[0].Kind
			s.loadModels(all[0].Kind)
		default:
			s.choosingAgent, s.side.choosingModel = ws.ID, ""
		}
	}
	if s.choosingAgent != ws.ID {
		return
	}
	open := true
	ui.Popover(c, plus, &open, func() {
		ui.Column(c).Width(280).Gap(2).Padding(8).Children(func() {
			if kind := s.side.choosingModel; kind != "" {
				s.modelPicker(c, ws, kind, &open)
				return
			}
			ui.Text(c, "新建会话").Bold().TextColor(t.Text).Padding(0, 6, 4)
			for _, a := range s.wb.Agents() {
				if ok, why := s.agentOK(a.Kind); !ok {
					// Unavailable: grayed, with why.
					ui.Row(c).Key(string(a.Kind)).Gap(8).Padding(6, 8).Opacity(0.5).Children(func() {
						agentGlyph(c, a.Kind, 16)
						ui.Column(c).Grow(1).Children(func() {
							ui.Text(c, a.Name).TextColor(t.Text)
							ui.Text(c, why).FontSize(11).TextColor(t.TextMuted)
						})
					})
					continue
				}
				if pickRow(c, string(a.Kind), "用 "+a.Name+" 新建会话", func() {
					agentGlyph(c, a.Kind, 16)
					ui.Text(c, a.Name).TextColor(t.Text).Grow(1)
					ui.Text(c, "›").TextColor(t.TextMuted)
				}).Clicked() {
					s.side.choosingModel = a.Kind
					s.loadModels(a.Kind)
				}
			}
		})
	})
	if !open {
		s.choosingAgent, s.side.choosingModel = "", ""
	}
}

// models are the models each Agent told, loaded once.
type models struct {
	list    []agent.Model
	loading bool
	err     string
}

func (s *Shell) loadModels(kind agent.Kind) {
	if s.models == nil {
		s.models = map[agent.Kind]*models{}
	}
	if m, ok := s.models[kind]; ok && (m.loading || m.list != nil) {
		return
	}
	m := &models{loading: true}
	s.models[kind] = m
	go func() {
		list, err := s.wb.Models(context.Background(), kind)
		s.later(func() {
			m.loading, m.list = false, list
			if err != nil {
				m.err = err.Error()
			}
		})
	}()
}

// modelPicker chooses the model of the new session: the Agent's default
// first.
func (s *Shell) modelPicker(c *ui.Context, ws model.Workspace, kind agent.Kind, open *bool) {
	t := c.Theme()
	ui.Row(c).Gap(6).AlignItems(ui.Center).Padding(0, 0, 4).Children(func() {
		if iconButton(c, "chevron.left", "返回选择 Agent").Clicked() {
			s.side.choosingModel = ""
		}
		agentGlyph(c, kind, 16)
		ui.Text(c, s.agentName(kind)+" 的模型").Bold().TextColor(t.Text)
	})
	m := s.models[kind]
	start := func(id string) {
		s.newSession(ws, kind, id)
		*open = false
	}
	if m == nil || m.loading {
		ui.Text(c, "正在读取模型列表……").FontSize(12).TextColor(t.TextMuted).Padding(4, 6)
	} else if m.err != "" {
		ui.Text(c, "读不到模型列表："+m.err).FontSize(11).TextColor(t.Warning).Padding(4, 6)
	}
	list := []agent.Model{{Name: "默认"}}
	if m != nil && len(m.list) > 0 {
		list = m.list
	}
	for _, x := range list {
		if pickRow(c, "m"+x.ID, "使用模型 "+x.Name, func() {
			ui.Column(c).Grow(1).Children(func() {
				ui.Text(c, x.Name).TextColor(t.Text)
				if x.Description != "" {
					ui.Text(c, x.Description).FontSize(11).TextColor(t.TextMuted).MaxLines(1)
				}
			})
		}).Clicked() {
			start(x.ID)
		}
	}
}

// relocate asks where a workspace's folder is now.
func (s *Shell) relocate(ws model.Workspace) {
	if s.opts.ChooseFolder == nil {
		return
	}
	go func() {
		p, ok := s.opts.ChooseFolder()
		if !ok {
			return
		}
		if err := s.wb.Relocate(ws.ID, p); err != nil {
			s.later(func() { s.notice = "重新定位失败：" + err.Error() })
		}
	}()
}

// renameDialog renames a session.
func (s *Shell) renameDialog(c *ui.Context) {
	if s.side.renaming == "" {
		return
	}
	t := c.Theme()
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(380).Gap(10).Children(func() {
			ui.Text(c, "重命名会话").Bold().TextColor(t.Text)
			in := ui.TextInput(c, &s.side.newTitle).Label("会话标题").Placeholder("留空则用第一条消息的开头").AutoFocus()
			ui.Row(c).Gap(6).Children(func() {
				ui.Spacer(c)
				if ui.Button(c, "取消").Clicked() {
					open = false
				}
				if ui.PrimaryButton(c, "确定").Clicked() || in.Submitted() {
					if err := s.wb.Rename(s.side.renaming, s.side.newTitle); err != nil {
						s.notice = err.Error()
					}
					open = false
				}
			})
		})
	})
	if !open {
		s.side.renaming = ""
	}
}

// deleteDialog asks before deleting a session, saying which references
// that breaks.
func (s *Shell) deleteDialog(c *ui.Context) {
	id := s.side.deleting
	if id == "" {
		return
	}
	t := c.Theme()
	x, _ := s.wb.Session(id)
	n := s.wb.ReferencesTo(id)
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(420).Gap(10).Children(func() {
			ui.Text(c, "删除「"+sessionTitle(x)+"」？").Bold().TextColor(t.Text)
			ui.Text(c, "会话的全部消息都会删除，不能恢复。只想让它不出现在侧栏，可以改为归档。").FontSize(12).TextColor(t.Text)
			if n > 0 {
				ui.Text(c, fmt.Sprintf("该会话被 %d 个引用使用，删除后这些引用将失效。", n)).FontSize(12).Bold().TextColor(t.Warning)
			}
			ui.Row(c).Gap(6).Children(func() {
				ui.Spacer(c)
				if ui.Button(c, "取消").Clicked() {
					open = false
				}
				if ui.Button(c, "删除").Label("确定删除").TextColor(t.Danger).Clicked() {
					if err := s.wb.DeleteSession(id); err != nil {
						s.notice = err.Error()
					} else if s.current == id {
						s.current = ""
					}
					open = false
				}
			})
		})
	})
	if !open {
		s.side.deleting = ""
	}
}
