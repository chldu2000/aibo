package shell

import (
	"fmt"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// View builds the window's content.
func (s *Shell) View(c *ui.Context) {
	s.apply()
	ui.Split(c, &s.split, func() {
		s.sidebar(c)
	}, func() {
		ui.Box(c).Fill().Margin(0, 0, 0, 4).Radius(14, 0, 0, 14).Clip().Background(c.Theme().Background).Children(func() {
			s.pane(c)
		})
	}).Fill()
}

// sidebar is the floating Liquid Glass sidebar. Fill ignores margins, so
// the gap around the glass is the outer box's padding.
func (s *Shell) sidebar(c *ui.Context) {
	t := c.Theme()
	ui.Box(c).Fill().Padding(8).Children(func() {
		ui.Column(c).Fill().Radius(16).Material(glass.Glass{Native: true}).Children(func() {
			ui.Scroll(c).Grow(1).Children(func() {
				ui.Column(c).Gap(2).Padding(40, 10, 10).Children(func() {
					ui.Row(c).Padding(0, 6, 8).AlignItems(ui.Center).Children(func() {
						ui.Text(c, "aibo").Bold().FontSize(15).TextColor(t.Text)
						ui.Spacer(c)
						if iconButton(c, "folder.badge.plus", "添加工作区").Clicked() {
							s.addWorkspace()
						}
					})
					s.workspaceGroups(c)
				})
			})
		})
	})
}

func (s *Shell) workspaceGroups(c *ui.Context) {
	t := c.Theme()
	workspaces := s.wb.Workspaces()
	if len(workspaces) == 0 {
		ui.Column(c).Gap(10).Padding(16, 6).Children(func() {
			ui.Text(c, "还没有工作区。添加一个项目文件夹，就可以在里面和 Agent 对话。").FontSize(12).TextColor(t.TextMuted)
			if ui.Button(c, "添加工作区…").Clicked() {
				s.addWorkspace()
			}
		})
		return
	}
	sessions := s.wb.Sessions()
	for _, ws := range workspaces {
		ui.Row(c).Padding(10, 6, 4).Gap(6).AlignItems(ui.Center).Key(ws.ID).Children(func() {
			ui.Text(c, workspaceName(ws)).FontSize(12).Bold().TextColor(t.TextMuted).Tooltip(ws.Path).Grow(1)
			plus := iconButton(c, "plus", "在 "+workspaceName(ws)+" 新建会话")
			if plus.Clicked() {
				if agents := s.wb.Agents(); len(agents) == 1 {
					s.newSession(ws, agents[0].Kind)
				} else {
					s.choosingAgent = ws.ID
				}
			}
			if s.choosingAgent == ws.ID {
				open := true
				ui.Popover(c, plus, &open, func() {
					ui.Column(c).Width(220).Gap(2).Padding(8).Children(func() {
						ui.Text(c, "新建会话").Bold().TextColor(t.Text).Padding(0, 6, 4)
						for _, a := range s.wb.Agents() {
							if pickRow(c, string(a.Kind), "用 "+a.Name+" 新建会话", func() {
								agentGlyph(c, a.Kind, 16)
								ui.Text(c, a.Name).TextColor(t.Text).Grow(1)
							}).Clicked() {
								s.newSession(ws, a.Kind)
								open = false
							}
						}
					})
				})
				if !open {
					s.choosingAgent = ""
				}
			}
		})
		for _, x := range sessions {
			if x.WorkspaceID != ws.ID {
				continue
			}
			row := ui.Row(c).Key(x.ID).Gap(8).Padding(6, 8).Radius(7).AlignItems(ui.Center).Children(func() {
				agentGlyph(c, x.Agent, 18)
				ui.Text(c, sessionTitle(x)).TextColor(t.Text).NoWrap().Grow(1)
				switch st := s.wb.Status(x.ID); {
				case st.Approvals > 0:
					ui.Text(c, fmt.Sprintf("待审批 %d", st.Approvals)).FontSize(11).Bold().TextColor(t.Warning)
				case st.Running:
					ui.Text(c, "运行中").FontSize(11).TextColor(t.TextMuted)
				}
			})
			if x.ID == s.current {
				row.Background(t.SurfacePressed)
			} else if row.Hovered() {
				row.Background(t.SurfaceHover)
			}
			if row.Clicked() {
				s.current = x.ID
			}
		}
	}
}

// pane is the session area: the messages under a floating glass header,
// and the composer.
func (s *Shell) pane(c *ui.Context) {
	t := c.Theme()
	x, ok := s.wb.Session(s.current)
	if !ok {
		ui.Column(c).Fill().AlignItems(ui.Center).Justify(ui.Center).Children(func() {
			ui.Text(c, "在左侧选一个会话，或在工作区上点“＋”新建").TextColor(t.TextMuted)
		})
		return
	}
	v := s.view(x.ID)
	ws := s.workspaceOf(x)
	ui.Box(c).Fill().Children(func() {
		// Chosen rows show in a light tint with the theme's text, not the
		// list's solid accent.
		th := *t
		if v.sel.on {
			th.Accent, th.AccentText = tinted(c, ui.RGBA(40, 120, 255, 0.28)), t.Text
		}
		ui.Themed(c, &th).Fill().Children(func() {
			ui.Column(c).Fill().Children(func() {
				s.messages(c, v, s.wb.Markers(x.ID)).Grow(1)
			})
		})
		ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(80).PassThrough().Material(glass.ScrollEdge{})
		ui.Row(c).Absolute().Top(12).Left(16).Right(16).Height(46).Radius(23).Padding(0, 16).Gap(10).AlignItems(ui.Center).Material(glass.Glass{}).Children(func() {
			agentGlyph(c, x.Agent, 20)
			ui.Text(c, sessionTitle(x)).Bold().TextColor(t.Text).NoWrap()
			ui.Text(c, ws.Path).FontSize(12).TextColor(t.TextMuted).NoWrap()
			ui.Spacer(c)
			if iconButton(c, "arrowshape.turn.up.right", "选择消息以引用或复制").Clicked() {
				if v.sel.on {
					s.stopSelecting(v)
				} else {
					s.startSelecting(v)
				}
			}
		})
		s.pullPanel(c, x) // before the composer, which it may give the focus back to
		ui.Column(c).Absolute().Bottom(16).Left(16).Right(16).Gap(8).Children(func() {
			s.banners(c, x.ID)
			// Approvals whose tool calls have not started yet.
			for _, a := range s.wb.LooseApprovals(x.ID) {
				s.approvalCard(c, x.ID, &a)
			}
			if v.sel.on {
				s.selectionBar(c, x, v)
			} else {
				s.composer(c, x, v)
			}
		})
	})
}

func (s *Shell) workspaceOf(x model.Session) model.Workspace {
	for _, ws := range s.wb.Workspaces() {
		if ws.ID == x.WorkspaceID {
			return ws
		}
	}
	return model.Workspace{}
}

func (s *Shell) messages(c *ui.Context, v *sessionView, markers []model.Marker) ui.Element {
	t := c.Theme()
	after := map[int][]model.Marker{}
	for _, mk := range markers {
		after[mk.AfterSeq] = append(after[mk.AfterSeq], mk)
	}
	return ui.List(c, &v.list, len(v.msgs), func(i int) {
		m := v.msgs[i]
		if i == 0 {
			for _, mk := range after[0] {
				divider(c, mk)
			}
		}
		defer func() {
			for _, mk := range after[m.Seq] {
				divider(c, mk)
			}
		}()
		// In selection mode a press anywhere on a message chooses it,
		// rather than selecting its text or pressing its buttons.
		row := ui.Row(c).Gap(10).AlignItems(ui.Start).Padding(4).Radius(10).IgnoreInput(v.sel.on).Children(func() {
			ui.Textf(c, "#%d", m.Seq).FontSize(11).TextColor(t.TextMuted).Width(34)
			ui.Column(c).Grow(1).MaxWidth(820).Gap(6).Children(func() {
				switch m.Kind {
				case model.UserMessage:
					for _, id := range m.Refs {
						s.referenceCard(c, id)
					}
					if m.Text != "" {
						ui.Text(c, m.Text).Selectable().TextColor(t.Text).Padding(8, 12).Radius(12).Background(t.Surface)
					}
				case model.ToolCall:
					s.tool(c, v, fmt.Sprint(m.Seq), m)
				case model.Plan:
					plan(c, m)
				default:
					s.reply(c, v, m)
				}
				if m.State == model.Interrupted && m.Kind != model.ToolCall {
					ui.Text(c, "已中断").FontSize(11).TextColor(t.TextMuted)
				}
			})
		})
		if v.highlight[0] > 0 && m.Seq >= v.highlight[0] && m.Seq <= v.highlight[1] {
			row.Background(tinted(c, ui.RGBA(40, 120, 255, 0.16)))
		}
	}).Padding(76, 20, 170).Gap(10).Children(func() {
		if len(v.msgs) == 0 {
			ui.Text(c, "发一条消息开始对话").TextColor(t.TextMuted).Margin(ui.Auto)
		}
	})
}

// banners are notices above the composer, in orange-tinted glass.
func (s *Shell) banners(c *ui.Context, id string) {
	bar := func(text string, dismiss func()) {
		ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
			ui.Text(c, text).TextColor(c.Theme().Text).Grow(1)
			if dismiss != nil && iconButton(c, "xmark", "关闭").Clicked() {
				dismiss()
			}
		})
	}
	if e := s.wb.Status(id).Error; e != "" {
		bar(e, nil)
	}
	if s.notice != "" {
		bar(s.notice, func() { s.notice = "" })
	}
	if x, ok := s.wb.Session(id); ok && x.Level == agent.FullAuto {
		// A warning that stays while the level does.
		ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
			sfsymbols.Symbol(c, "exclamationmark.shield").Size(14).Color(c.Theme().Warning)
			ui.Text(c, "全部自动：这个会话里 Agent 的所有操作都不再询问").TextColor(c.Theme().Text).Grow(1)
			if ui.Button(c, "改回每次询问").Clicked() {
				s.setLevel(id, agent.AskAlways)
			}
		})
	}
	if v := s.views[id]; v != nil && v.highlight[0] > 0 {
		ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(40, 120, 255, 0.25))}).Children(func() {
			ui.Text(c, "已高亮被引用的范围 "+refs.Range(v.highlight[0], v.highlight[1])).TextColor(c.Theme().Text).Grow(1)
			if iconButton(c, "xmark", "取消高亮").Clicked() {
				v.highlight = [2]int{}
			}
		})
	}
}

// composer is the glass input card: Enter sends, Shift+Enter breaks the
// line, and the round button sends or, while the Agent replies, stops.
func (s *Shell) composer(c *ui.Context, x model.Session, v *sessionView) {
	t := c.Theme()
	running := s.wb.Status(x.ID).Running
	drafts := s.wb.Drafts(x.ID)
	ui.Column(c).Gap(6).Padding(10, 12).Radius(18).Material(glass.Glass{}).Children(func() {
		if len(drafts) > 0 {
			ui.Row(c).Gap(6).Wrap().Children(func() {
				for _, r := range drafts {
					ui.Row(c).Key(r.ID).Gap(6).Padding(3, 4, 3, 8).Radius(8).AlignItems(ui.Center).BorderWidth(1).BorderColor(t.Accent).Children(func() {
						sfsymbols.Symbol(c, "paperclip").Size(12).Color(t.Accent)
						ui.Text(c, s.refLabel(r)).FontSize(12).TextColor(t.Text)
						if iconButton(c, "xmark", "移除引用").Clicked() {
							if err := s.wb.RemoveDraft(r.ID); err != nil {
								s.notice = err.Error()
							}
						}
					})
				}
			})
		}
		prompt := "给 " + s.agentName(x.Agent) + " 发消息"
		input := ui.TextArea(c, &v.draft).Placeholder(prompt).Label(prompt).MinHeight(44).OnTextKey(func(k ui.TextKey) bool {
			if k.Key != ui.KeyEnter || k.Mods != 0 {
				return false
			}
			if !running && (strings.TrimSpace(k.Text()) != "" || len(drafts) > 0) && s.send(x.ID, k.Text()) {
				k.SetText("")
			}
			return true
		})
		if s.refocus {
			input.Focus()
			s.refocus = false
		}
		// Typing "@" opens the @ panel instead.
		if draft, at := typedAt(v.typed, v.draft); at {
			v.draft = draft
			s.openPull()
		}
		v.typed = v.draft
		ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
			if iconButton(c, "at", "引用其他会话（@）").Clicked() {
				s.openPull()
			}
			if iconButton(c, "arrow.down.right.and.arrow.up.left", "压缩上下文").Clicked() {
				if err := s.wb.Compact(x.ID); err != nil {
					s.notice = err.Error()
				}
			}
			s.levelControl(c, x)
			ui.Spacer(c)
			if running {
				if roundButton(c, "stop.fill", "停止", t.Text, t.Background).Clicked() {
					if err := s.wb.Stop(x.ID); err != nil {
						s.notice = err.Error()
					}
				}
				return
			}
			bg := t.Accent
			empty := strings.TrimSpace(v.draft) == "" && len(drafts) == 0
			if empty {
				bg = t.Border
			}
			if roundButton(c, "arrow.up", "发送（Enter）", bg, t.AccentText).Clicked() && !empty {
				if s.send(x.ID, v.draft) {
					v.draft = ""
				}
			}
		})
	})
}

func (s *Shell) agentName(kind agent.Kind) string {
	for _, a := range s.wb.Agents() {
		if a.Kind == kind {
			return a.Name
		}
	}
	return string(kind)
}

// iconButton is a borderless button showing an SF Symbol.
func iconButton(c *ui.Context, symbol, tip string) ui.Element {
	t := c.Theme()
	b := ui.Box(c).Padding(5).Radius(7).Tooltip(tip).Label(tip).Children(func() {
		sfsymbols.Symbol(c, symbol).Size(15).Color(t.Text)
	})
	if b.Hovered() {
		b.Background(t.SurfaceHover)
	}
	return b
}

// roundButton is the composer's round send/stop button.
func roundButton(c *ui.Context, symbol, tip string, bg, fg ui.Color) ui.Element {
	return ui.Box(c).Size(30, 30).Radius(15).Background(bg).AlignItems(ui.Center).Justify(ui.Center).Tooltip(tip).Label(tip).Children(func() {
		sfsymbols.Symbol(c, symbol).Size(13).Color(fg)
	})
}

// tinted lightens a glass tint in the light appearance, where it is about
// 45% as strong as in the dark one, so that theme text stays legible.
func tinted(c *ui.Context, col ui.Color) ui.Color {
	if c.Theme().Dark {
		return col
	}
	return ui.RGBA(col.R, col.G, col.B, float32(col.A)/255*0.45)
}

// Self-drawn agent glyphs (never the vendors' logos), shown with
// ui.Image so that they keep their colors.
var (
	claudeGlyph = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#c96442"/><g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5.9 8.5l12.2 7"/><path d="M5.9 15.5l12.2-7"/></g></svg>`))
	codexGlyph  = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2f2f33" stroke="#5a5a62" stroke-width="1"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l4 4-4 4"/><path d="M13 16h5"/></g></svg>`))
	fakeGlyph   = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#6e6e78"/><g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="10" r="4"/><path d="M6 19c1.5-2.5 3.5-3.5 6-3.5s4.5 1 6 3.5"/></g></svg>`))
)

func agentGlyph(c *ui.Context, kind agent.Kind, size float32) ui.Element {
	g, name := fakeGlyph, string(kind)
	switch kind {
	case fake.Kind:
		name = "假 Agent"
	case claude.Kind:
		g, name = claudeGlyph, "Claude Code"
	case codex.Kind:
		g, name = codexGlyph, "Codex"
	}
	return ui.Image(c, g).Size(size, size).Tooltip(name)
}

// refLabel names a reference in one line: source, title and range.
func (s *Shell) refLabel(r model.Reference) string {
	if r.SourceID == r.TargetID {
		return fmt.Sprintf("本会话 · %s（%d 条）", refs.Range(r.From, r.To), r.Count)
	}
	return fmt.Sprintf("%s · %s · %s（%d 条）", s.agentName(r.SourceAgent), r.SourceTitle, refs.Range(r.From, r.To), r.Count)
}

// referenceCard shows a delivered reference in blue-tinted glass: one
// line, and when opened, the text the Agent received and its reads.
func (s *Shell) referenceCard(c *ui.Context, id string) {
	t := c.Theme()
	r, ok := s.wb.Reference(id)
	if !ok {
		return
	}
	_, sourceExists := s.wb.Session(r.SourceID)
	ui.Column(c).Key(id).Gap(6).Padding(8, 10).Radius(14).Material(glass.Glass{Tint: tinted(c, ui.RGBA(40, 120, 255, 0.18))}).Children(func() {
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			sfsymbols.Symbol(c, "paperclip").Size(12).Color(t.Text)
			ui.Text(c, s.refLabel(r)).FontSize(12).TextColor(t.Text).Grow(1)
			label := "查看概要"
			if s.openCards[id] {
				label = "收起"
			}
			if ui.Button(c, label).Clicked() {
				s.openCards[id] = !s.openCards[id]
			}
		})
		if !sourceExists {
			ui.Text(c, "源会话已被删除，这个引用已失效").FontSize(12).TextColor(t.Warning)
		}
		for i, rd := range r.Reads {
			ui.Row(c).Key(i).Gap(6).AlignItems(ui.Center).Children(func() {
				sfsymbols.Symbol(c, "eye").Size(11).Color(t.TextMuted)
				ui.Text(c, "Agent 读取了 "+refs.Range(rd.From, rd.To)).FontSize(12).TextColor(t.TextMuted)
				if sourceExists && ui.Button(c, "在源会话中查看").Clicked() {
					s.reveal(r.SourceID, rd.From, rd.To)
				}
			})
		}
		if s.openCards[id] {
			ui.Text(c, r.Brief).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable()
		}
	})
}

// reveal opens a session at messages from..to, highlighted.
func (s *Shell) reveal(sessionID string, from, to int) {
	s.current = sessionID
	v := s.view(sessionID)
	v.highlight = [2]int{from, to}
	v.list.FollowEnd = false
	for i, m := range v.msgs {
		if m.Seq == from {
			v.list.ScrollTo(i, ui.Start)
			break
		}
	}
}

// divider shows a marker as a line across the session: where the Agent
// compacted its context, or a new native session took over.
func divider(c *ui.Context, mk model.Marker) {
	t := c.Theme()
	text := "已切换到新的 Agent 原生会话"
	if mk.Kind == model.Compaction {
		text = "上下文已压缩 · 自动"
		if mk.Trigger == "manual" {
			text = "上下文已压缩 · 手动"
		}
		if mk.PreTokens > 0 {
			text += fmt.Sprintf(" · %s → %s tokens", kTokens(mk.PreTokens), kTokens(mk.PostTokens))
		}
	}
	ui.Row(c).Gap(8).Padding(6, 0).AlignItems(ui.Center).Children(func() {
		ui.Box(c).Height(1).Grow(1).Background(t.Border)
		ui.Text(c, text).FontSize(11).TextColor(t.TextMuted).NoWrap()
		ui.Box(c).Height(1).Grow(1).Background(t.Border)
	})
}

// kTokens writes a token count as 19.7k.
func kTokens(n int) string {
	if n < 1000 {
		return fmt.Sprint(n)
	}
	return fmt.Sprintf("%.1fk", float64(n)/1000)
}
