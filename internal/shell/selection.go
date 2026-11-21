package shell

import (
	"fmt"
	"slices"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// selection is a session's selection mode: the user chooses whole
// messages (click, Shift-click, Cmd-click, drag, Cmd+A) to reference or
// copy them. The choice is always one range: when it has gaps, they are
// filled, and the user is told.
type selection struct {
	on     bool
	chosen ui.Selection[int] // by sequence number
	// filled is set when the last change of the choice had gaps that
	// were filled, until the choice changes again.
	filled   bool
	from, to int
	// sending shows the targets; target, once picked, the preview.
	sending bool
	target  *target
}

// target is where the reference goes: an existing session, or a new one
// of an Agent in a workspace.
type target struct {
	sessionID   string
	agent       agent.Kind
	workspaceID string
	label       string
	brief       string
}

// startSelecting turns selection mode on for the open session.
func (s *Shell) startSelecting(v *sessionView) {
	v.sel = selection{on: true}
	v.list.Selection = &v.sel.chosen
	v.list.DragSelect = true
	v.list.FollowEnd = false
}

func (s *Shell) stopSelecting(v *sessionView) {
	v.sel = selection{}
	v.list.Selection = nil
	v.list.DragSelect = false
	v.list.FollowEnd = true
}

// normalize makes the choice one range, filling its gaps.
func (v *sessionView) normalize() {
	sel := &v.sel
	seqs := slices.Collect(sel.chosen.All())
	from, to, filled := refs.Normalize(seqs)
	if from == sel.from && to == sel.to && !filled {
		return
	}
	if filled {
		for _, m := range v.msgs {
			if m.Seq > from && m.Seq < to {
				sel.chosen.Add(m.Seq)
			}
		}
	}
	sel.from, sel.to, sel.filled = from, to, filled
}

// choose makes the choice messages from..to.
func (v *sessionView) choose(from, to int) {
	v.sel.chosen.Clear()
	for _, m := range v.msgs {
		if m.Seq >= from && m.Seq <= to {
			v.sel.chosen.Add(m.Seq)
		}
	}
	v.sel.from, v.sel.to, v.sel.filled = from, to, false
}

// wholeTurns widens the choice to the turns it touches: from the user
// message that starts the first (or the session's start), to the message
// before the next user message (or the session's end).
func (v *sessionView) wholeTurns() {
	if len(v.msgs) == 0 {
		return
	}
	from, to := v.msgs[0].Seq, v.msgs[len(v.msgs)-1].Seq
	for _, m := range v.msgs {
		if m.Kind != model.UserMessage {
			continue
		}
		if m.Seq <= v.sel.from {
			from = m.Seq
		} else if m.Seq > v.sel.to {
			to = m.Seq - 1
			break
		}
	}
	v.choose(from, to)
}

// copyText is the chosen messages, from the data, for the clipboard.
func (s *Shell) copyText(x model.Session, v *sessionView) string {
	var b strings.Builder
	for _, m := range v.msgs {
		if !v.sel.chosen.Has(m.Seq) {
			continue
		}
		role := "用户"
		if m.Kind != model.UserMessage {
			role = s.agentName(x.Agent)
		}
		fmt.Fprintf(&b, "### [%d] %s\n\n%s\n\n", m.Seq, role, strings.TrimRight(m.Text, "\n"))
	}
	return strings.TrimRight(b.String(), "\n") + "\n"
}

// selectionBar takes the composer's place in selection mode.
func (s *Shell) selectionBar(c *ui.Context, x model.Session, v *sessionView) {
	t := c.Theme()
	v.normalize()
	sel := &v.sel
	n := sel.chosen.Len()
	ui.Column(c).Gap(8).Padding(10, 12).Radius(18).Material(glass.Glass{}).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			if n == 0 {
				ui.Text(c, "点击消息设起点，Shift+点击扩展，也可以拖选").TextColor(t.TextMuted)
			} else {
				ui.Text(c, fmt.Sprintf("已选 %s · %d 条", refs.Range(sel.from, sel.to), n)).Bold().TextColor(t.Text)
				if sel.filled {
					ui.Text(c, "已补齐中间的消息").FontSize(12).TextColor(t.Warning)
				}
			}
		})
		ui.Row(c).Gap(6).AlignItems(ui.Center).Wrap().Children(func() {
			if ui.Button(c, "选中整个会话").Clicked() && len(v.msgs) > 0 {
				v.choose(v.msgs[0].Seq, v.msgs[len(v.msgs)-1].Seq)
			}
			if ui.Button(c, "选中整轮").Disabled(n == 0).Clicked() && n > 0 {
				v.wholeTurns()
			}
			if ui.Button(c, "复制").Disabled(n == 0).Clicked() && n > 0 {
				c.WriteClipboard(s.copyText(x, v))
			}
			ui.Spacer(c)
			if ui.Button(c, "取消").Clicked() {
				s.stopSelecting(v)
				return
			}
			send := ui.PrimaryButton(c, "发给…").Disabled(n == 0)
			if send.Clicked() && n > 0 {
				sel.sending, sel.target = !sel.sending, nil
			}
			ui.Popover(c, send, &sel.sending, func() {
				if sel.target == nil {
					s.targets(c, x, v)
				} else {
					s.preview(c, x, v)
				}
			})
		})
	})
}

// targets lists where the choice can go: other sessions, or a new
// session of each Agent in each workspace.
func (s *Shell) targets(c *ui.Context, src model.Session, v *sessionView) {
	t := c.Theme()
	pick := func(tg target) {
		brief, err := s.wb.PreviewBrief(src.ID, v.sel.from, v.sel.to, workbench.Target{SessionID: tg.sessionID, Agent: tg.agent, WorkspaceID: tg.workspaceID})
		if err != nil {
			v.sel.sending = false
			s.notice = "无法引用：" + err.Error()
			return
		}
		tg.brief = brief
		v.sel.target = &tg
	}
	ui.Column(c).Width(340).Gap(2).Padding(10).Children(func() {
		ui.Text(c, fmt.Sprintf("把 %s 引用给…", refs.Range(v.sel.from, v.sel.to))).Bold().TextColor(t.Text).Padding(0, 6, 6)
		// The session itself: to find again what its Agent compacted away.
		if pickRow(c, "self", "引用给本会话", func() {
			agentGlyph(c, src.Agent, 16)
			ui.Text(c, "本会话（找回之前的内容）").TextColor(t.Text).Grow(1)
		}).Clicked() {
			pick(target{sessionID: src.ID, agent: src.Agent, workspaceID: src.WorkspaceID, label: "本会话"})
		}
		sessions := s.wb.Sessions()
		for _, ws := range s.wb.Workspaces() {
			ui.Text(c, workspaceName(ws)).FontSize(11).Bold().TextColor(t.TextMuted).Padding(8, 6, 2)
			for _, a := range s.wb.Agents() {
				label := "新建 " + a.Name + " 会话"
				row := pickRow(c, ws.ID+string(a.Kind), "引用给 "+workspaceName(ws)+" 的新 "+a.Name+" 会话", func() {
					agentGlyph(c, a.Kind, 16)
					ui.Text(c, label).TextColor(t.Text).Grow(1)
				})
				if row.Clicked() {
					pick(target{agent: a.Kind, workspaceID: ws.ID, label: workspaceName(ws) + " 的新 " + a.Name + " 会话"})
				}
			}
			for _, x := range sessions {
				if x.WorkspaceID != ws.ID || x.ID == src.ID {
					continue
				}
				row := pickRow(c, x.ID, "引用给 "+sessionTitle(x), func() {
					agentGlyph(c, x.Agent, 16)
					ui.Text(c, sessionTitle(x)).TextColor(t.Text).NoWrap().Grow(1)
				})
				if row.Clicked() {
					pick(target{sessionID: x.ID, agent: x.Agent, workspaceID: x.WorkspaceID, label: "「" + sessionTitle(x) + "」"})
				}
			}
		}
	})
}

func pickRow(c *ui.Context, key, label string, children func()) ui.Element {
	t := c.Theme()
	row := ui.Row(c).Key(key).Gap(8).Padding(6, 8).Radius(7).AlignItems(ui.Center).Label(label).Children(children)
	if row.Hovered() {
		row.Background(t.SurfaceHover)
	}
	return row
}

// preview shows the brief the target's Agent will get, before the
// reference is made.
func (s *Shell) preview(c *ui.Context, src model.Session, v *sessionView) {
	t := c.Theme()
	tg := v.sel.target
	ui.Column(c).Width(560).Gap(10).Padding(14).Children(func() {
		ui.Text(c, "引用给 "+tg.label).Bold().TextColor(t.Text)
		ui.Text(c, "接收方 Agent 会收到下面的概要，需要细节时再通过工具读取引用的内容：").FontSize(12).TextColor(t.TextMuted)
		ui.Scroll(c).MaxHeight(320).Radius(10).Background(t.Surface).Children(func() {
			ui.Text(c, tg.brief).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable().Padding(10)
		})
		ui.Row(c).Gap(6).Children(func() {
			ui.Spacer(c)
			if ui.Button(c, "返回").Clicked() {
				v.sel.target = nil
			}
			if ui.PrimaryButton(c, "引用").Clicked() {
				s.confirm(src, v)
			}
		})
	})
}

// confirm makes the reference, a draft in the target's composer, and
// opens the target.
func (s *Shell) confirm(src model.Session, v *sessionView) {
	tg := v.sel.target
	targetID := tg.sessionID
	if targetID == "" {
		x, err := s.wb.NewSession(tg.workspaceID, tg.agent, "")
		if err != nil {
			s.notice = "新建会话失败：" + err.Error()
			return
		}
		targetID = x.ID
	}
	if _, err := s.wb.ReferenceRange(src.ID, v.sel.from, v.sel.to, targetID); err != nil {
		s.notice = "引用失败：" + err.Error()
		return
	}
	s.stopSelecting(v)
	s.goTo(targetID, 0, 0)
}
