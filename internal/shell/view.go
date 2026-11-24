package shell

import (
	"errors"
	"fmt"
	"github.com/chldu2000/aibo/locales"
	"strings"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// View builds the window's content.
func (s *Shell) View(c *ui.Context) {
	s.apply()
	if c.Shortcut(ui.Super, ui.KeyComma) {
		s.openSettings()
	}
	if s.opts.Only != "" {
		// A session's own window: its area alone.
		ui.Box(c).Fill().Background(c.Theme().Background).Children(func() {
			s.pane(c)
		})
		s.renameDialog(c)
		s.deleteDialog(c)
		return
	}
	s.settingsModal(c)
	root := ui.Split(c, &s.split, func() {
		s.sidebar(c)
	}, func() {
		ui.Box(c).Fill().Margin(0, 0, 0, 4).Radius(14, 0, 0, 14).Clip().Background(c.Theme().Background).Children(func() {
			s.pane(c)
		})
	}).Fill()
	// Folders dropped on the window become workspaces.
	for _, p := range root.DroppedFiles() {
		if _, err := s.wb.AddWorkspace(p); err != nil {
			s.notice = s.failed(locales.AddWorkspaceFailed, err)
		}
	}
}

// The floating header of the session area spans these, from the top.
const headerTop, headerBottom = 12, 58

// pane is the session area: the messages under a floating glass header,
// and the composer.
func (s *Shell) pane(c *ui.Context) {
	t := c.Theme()
	bar := c.TitleBar()
	x, ok := s.wb.Session(s.current)
	if !ok {
		ui.Box(c).Fill().Children(func() {
			ui.Column(c).Fill().AlignItems(ui.Center).Justify(ui.Center).Children(func() {
				if s.opts.Only != "" {
					ui.Text(c, locales.SessionDeleted()).TextColor(t.TextMuted)
					return
				}
				ui.Text(c, locales.NoSessionOpen()).TextColor(t.TextMuted)
			})
			// Nothing to scroll here: the whole header band moves the window.
			ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(max(bar.Height, headerBottom)).DragWindow()
			s.windowCapsule(c)
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
				s.messages(c, x, v, s.wb.Markers(x.ID)).Grow(1)
			})
		})
		ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(80).PassThrough().Material(glass.ScrollEdge{})
		// The window moves by the floating header and the gap above it;
		// a session's own window has the traffic lights over its area,
		// left of the header, and moves by that corner too. The messages
		// under the rest of the header's band still scroll.
		left := float32(16)
		if s.opts.Only != "" {
			left = max(left, bar.Left+12)
			ui.Box(c).Absolute().Top(0).Left(0).Width(left).Height(headerBottom).DragWindow()
		}
		ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(headerTop).DragWindow()
		right := max(float32(16), bar.Right+12)
		if s.window != nil {
			right = capsuleRight + capsuleWidth + 8
		}
		ui.Row(c).Absolute().Top(headerTop).Left(left).Right(right).Height(headerBottom-headerTop).Radius(23).Clip().Padding(0, 16).Gap(10).AlignItems(ui.Center).Material(glass.Glass{}).DragWindow().Children(func() {
			s.agentGlyph(c, x.Agent, 20)
			ui.Text(c, sessionTitle(x)).Bold().TextColor(t.Text).MaxLines(1)
			ui.Text(c, ws.Path).FontSize(12).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().Grow(1)
			if iconButton(c, "arrowshape.turn.up.right", locales.SelectMessages()).Clicked() {
				if v.sel.on {
					s.stopSelecting(v)
				} else {
					s.startSelecting(v)
				}
			}
			if s.opts.OpenWindow != nil && iconButton(c, "rectangle.on.rectangle", locales.OpenInWindow()).Clicked() {
				s.opts.OpenWindow(x.ID)
			}
			if iconButton(c, "sidebar.trailing", locales.SessionDetails()).Clicked() {
				s.detail.open, s.detail.confirming = !s.detail.open, ""
			}
		})
		s.windowCapsule(c)
		s.details(c, x)
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
				s.badges(c, x, v)
				s.composer(c, x, v)
			}
		})
	})
}

func (s *Shell) workspaceOf(x model.Session) model.Workspace {
	ws, _ := s.wb.Workspace(x.WorkspaceID)
	return ws
}

func (s *Shell) messages(c *ui.Context, x model.Session, v *sessionView, markers []model.Marker) ui.Element {
	t := c.Theme()
	after := map[int][]model.Marker{}
	for _, mk := range markers {
		after[mk.AfterSeq] = append(after[mk.AfterSeq], mk)
	}
	// While a turn runs, a last row says so (working), so that it shows
	// where the reply comes, not only in the sidebar.
	st := s.wb.Status(x.ID)
	n := len(v.msgs)
	if st.Running && !v.sel.on {
		n++
	}
	return ui.List(c, &v.list, n, func(i int) {
		if i >= len(v.msgs) {
			s.working(c, x, st)
			return
		}
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
			ui.Textf(c, "#%d", m.Seq).FontSize(11).TextColor(t.TextMuted).Width(44).MaxLines(1)
			ui.Column(c).Grow(1).MinWidth(0).MaxWidth(820).Gap(6).Children(func() {
				switch m.Kind {
				case model.UserMessage:
					for _, id := range m.Refs {
						s.referenceCard(c, id)
					}
					if len(m.Mentions) > 0 {
						ui.Row(c).Gap(6).Wrap().Children(func() {
							for _, f := range m.Mentions {
								s.mentionChip(c, x, f, nil)
							}
						})
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
					ui.Text(c, locales.Interrupted()).FontSize(11).TextColor(t.TextMuted)
				}
			})
		})
		if v.highlight[0] > 0 && m.Seq >= v.highlight[0] && m.Seq <= v.highlight[1] {
			row.Background(tinted(c, ui.RGBA(40, 120, 255, 0.16)))
		}
	}).Padding(76, 20, 170).Gap(10).Children(func() {
		if len(v.msgs) == 0 {
			ui.Text(c, locales.StartConversation()).TextColor(t.TextMuted).Margin(ui.Auto)
		}
	})
}

// banners are notices above the composer, in orange-tinted glass.
func (s *Shell) banners(c *ui.Context, id string) {
	bar := func(text string, dismiss func()) {
		ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
			ui.Text(c, text).TextColor(c.Theme().Text).Grow(1)
			if dismiss != nil && iconButton(c, "xmark", locales.Close()).Clicked() {
				dismiss()
			}
		})
	}
	st := s.wb.Status(id)
	x, ok := s.wb.Session(id)
	var failure *workbench.Failure
	if errors.As(st.Error, &failure) {
		bar(s.sayFailure(s.agentName(x.Agent), failure), nil)
	}
	if st.ResumeFailed != nil {
		s.resumeBanner(c, id, st)
	}
	if ok {
		s.loginBanner(c, x, st)
		ws := s.workspaceOf(x)
		if ws.Missing {
			ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
				ui.Text(c, locales.WorkspaceMissing(ws.Path)).TextColor(c.Theme().Text).Grow(1)
				if ui.Button(c, locales.Relocate()).Clicked() {
					s.relocate(ws)
				}
			})
		}
		if x.Archived {
			ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{}).Children(func() {
				ui.Text(c, locales.ArchivedNote()).FontSize(12).TextColor(c.Theme().Text).Grow(1)
				if ui.Button(c, locales.Unarchive()).Clicked() {
					if err := s.wb.SetArchived(x.ID, false); err != nil {
						s.notice = s.say(err)
					}
				}
			})
		}
	}
	if s.notice != "" {
		bar(s.notice, func() { s.notice = "" })
	}
	if v := s.views[id]; v != nil && v.highlight[0] > 0 {
		ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(40, 120, 255, 0.25))}).Children(func() {
			ui.Text(c, locales.Highlighted(refs.Range(v.highlight[0], v.highlight[1]))).TextColor(c.Theme().Text).Grow(1)
			if iconButton(c, "xmark", locales.ClearHighlight()).Clicked() {
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
		if len(drafts) > 0 || len(v.mentions) > 0 {
			ui.Row(c).Gap(6).Wrap().Children(func() {
				s.draftMentions(c, x, v)
				for _, r := range drafts {
					ui.Row(c).Key(r.ID).Gap(6).Padding(3, 4, 3, 8).Radius(8).AlignItems(ui.Center).BorderWidth(1).BorderColor(t.Accent).Children(func() {
						icon(c, "paperclip").Size(12).Color(t.Accent)
						ui.Text(c, s.refLabel(r)).FontSize(12).TextColor(t.Text)
						if iconButton(c, "xmark", locales.RemoveReference()).Clicked() {
							if err := s.wb.RemoveDraft(r.ID); err != nil {
								s.notice = s.say(err)
							}
						}
					})
				}
			})
		}
		prompt := locales.MessageAgent(s.agentName(x.Agent))
		blocked := s.wb.Status(x.ID).ResumeFailed != nil
		if blocked {
			prompt = locales.ComposerBlocked()
		}
		input := ui.TextArea(c, &v.draft).Placeholder(prompt).Label(prompt).MinHeight(44).Disabled(blocked).OnPaste(func(string) bool {
			v.pasted = true
			return false
		}).OnTextKey(func(k ui.TextKey) bool {
			if k.Key != ui.KeyEnter || k.Mods != 0 {
				return false
			}
			if !running && (strings.TrimSpace(k.Text()) != "" || len(drafts) > 0 || len(v.mentions) > 0) && s.send(x.ID, k.Text()) {
				k.SetText("")
			}
			return true
		})
		if s.refocus {
			input.Focus()
			s.refocus = false
		}
		// Typing "@" opens the @ panel too; a paste with one does not.
		if at, ok := typedAt(v.typed, v.draft); ok && !v.pasted {
			s.openPull(x.ID, at)
		}
		v.typed, v.pasted = v.draft, false
		ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
			iconButton(c, "paperclip", locales.Attach()).Opacity(0.4)
			if iconButton(c, "at", locales.MentionButton()).Clicked() {
				s.openPull(x.ID, -1)
			}
			s.modelControls(c, x, running)
			s.modeControl(c, x)
			ui.Spacer(c)
			if running {
				if roundButton(c, "stop.fill", locales.Stop(), t.Text, t.Background).Clicked() {
					if err := s.wb.Stop(x.ID); err != nil {
						s.notice = s.say(err)
					}
				}
				return
			}
			bg := t.Accent
			empty := strings.TrimSpace(v.draft) == "" && len(drafts) == 0 && len(v.mentions) == 0
			if empty {
				bg = t.Border
			}
			if roundButton(c, "arrow.up", locales.Send(), bg, t.AccentText).Clicked() && !empty {
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
		icon(c, symbol).Size(15).Color(t.Text)
	})
	if b.Hovered() {
		b.Background(t.SurfaceHover)
	}
	return b
}

// roundButton is the composer's round send/stop button.
func roundButton(c *ui.Context, symbol, tip string, bg, fg ui.Color) ui.Element {
	return ui.Box(c).Size(30, 30).Radius(15).Background(bg).AlignItems(ui.Center).Justify(ui.Center).Tooltip(tip).Label(tip).Children(func() {
		icon(c, symbol).Size(13).Color(fg)
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

// genericGlyph is the icon of an Agent aibo has none for, as the fake.
var genericGlyph = ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#6e6e78"/><g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="10" r="4"/><path d="M6 19c1.5-2.5 3.5-3.5 6-3.5s4.5 1 6 3.5"/></g></svg>`))

// agentGlyph is an Agent's icon (agents.Spec.Glyph), its name on hover.
func (s *Shell) agentGlyph(c *ui.Context, kind agent.Kind, size float32) ui.Element {
	g, ok := s.glyphs[kind]
	if !ok {
		g = genericGlyph
		if d := s.describe(kind); d.Glyph != nil {
			g = ui.MustParseSVG(d.Glyph)
		}
		if s.glyphs == nil {
			s.glyphs = map[agent.Kind]*ui.SVG{}
		}
		s.glyphs[kind] = g
	}
	return ui.Image(c, g).Size(size, size).Tooltip(s.agentName(kind))
}

// refLabel names a reference in one line: source, title and range.
func (s *Shell) refLabel(r model.Reference) string {
	if r.SourceID == r.TargetID {
		return locales.RefThisSession(refs.Range(r.From, r.To), r.Count)
	}
	return locales.RefOtherSession(s.agentName(r.SourceAgent), r.SourceTitle, refs.Range(r.From, r.To), r.Count)
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
			icon(c, "paperclip").Size(12).Color(t.Text)
			ui.Text(c, s.refLabel(r)).FontSize(12).TextColor(t.Text).Grow(1)
			label := locales.ShowBrief()
			if s.openCards[id] {
				label = locales.HideBrief()
			}
			if ui.Button(c, label).Clicked() {
				s.openCards[id] = !s.openCards[id]
			}
		})
		if !sourceExists {
			ui.Text(c, locales.RefSourceDeleted()).FontSize(12).TextColor(t.Warning)
		}
		for i, rd := range r.Reads {
			ui.Row(c).Key(i).Gap(6).AlignItems(ui.Center).Children(func() {
				icon(c, "eye").Size(11).Color(t.TextMuted)
				ui.Text(c, locales.AgentRead(refs.Range(rd.From, rd.To))).FontSize(12).TextColor(t.TextMuted)
				if sourceExists && ui.Button(c, locales.ShowInSource()).Clicked() {
					s.goTo(r.SourceID, rd.From, rd.To)
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
	text := locales.NewNativeSession()
	if mk.Kind == model.Compaction {
		text = locales.CompactedAuto()
		if mk.Trigger == "manual" {
			text = locales.CompactedManual()
		}
		if mk.PreTokens > 0 {
			text = locales.CompactedTokens(text, kTokens(mk.PreTokens), kTokens(mk.PostTokens))
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

// resumeBanner says the native session could not be resumed, in the
// Agent's words, and offers what to do: a new native session, with the
// earlier messages referenced or not, or nothing for now (read-only).
func (s *Shell) resumeBanner(c *ui.Context, id string, st workbench.Status) {
	t := c.Theme()
	recover := func(r workbench.Recovery) {
		if err := s.wb.Recover(id, r); err != nil {
			s.notice = s.say(err)
		}
	}
	ui.Column(c).Gap(8).Padding(10, 12).Radius(14).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
		if st.ReadOnly {
			ui.Text(c, locales.ReadOnlyResume()).Bold().TextColor(t.Text)
		} else {
			ui.Text(c, locales.CannotResume()).Bold().TextColor(t.Text)
			ui.Text(c, agent.Detail(st.ResumeFailed, agent.ErrResumeFailed)).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable()
			ui.Text(c, locales.ResumeExplain()).FontSize(12).TextColor(t.TextMuted)
		}
		ui.Row(c).Gap(6).Wrap().Children(func() {
			if ui.PrimaryButton(c, locales.FreshWithReference()).Clicked() {
				recover(workbench.FreshWithReference)
			}
			if ui.Button(c, locales.FreshPlain()).Clicked() {
				recover(workbench.Fresh)
			}
			if !st.ReadOnly && ui.Button(c, locales.Later()).Clicked() {
				recover(workbench.Later)
			}
		})
	})
}

// working is the last row of a session whose turn runs: who works and for
// how long, or that it waits on the user, or why the Agent retries.
func (s *Shell) working(c *ui.Context, x model.Session, st workbench.Status) {
	t := c.Theme()
	ui.Row(c).Gap(10).AlignItems(ui.Start).Padding(4).Children(func() {
		ui.Box(c).Width(44)
		ui.Column(c).Grow(1).MaxWidth(820).Gap(4).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Spinner(c).Label(locales.Running())
				what := locales.AgentWorking(s.agentName(x.Agent))
				if st.Approvals > 0 {
					what = locales.AgentWaiting(s.agentName(x.Agent))
				}
				if !st.Since.IsZero() {
					what += " · " + elapsed(time.Since(st.Since))
				}
				ui.Text(c, what).FontSize(13).TextColor(t.TextMuted)
			})
			if r := st.Retrying; r != nil {
				text := locales.Retrying()
				if r.Max > 0 {
					text = locales.RetryingCount(r.Attempt, r.Max)
				}
				ui.Row(c).Gap(6).AlignItems(ui.Start).Children(func() {
					icon(c, "wifi.exclamationmark").Size(12).Color(t.Warning)
					ui.Text(c, withDetail(text, r.Message)).FontSize(12).TextColor(t.Warning).Selectable().Grow(1)
				})
			}
		})
	})
}

// elapsed is a duration as 1m 05s.
func elapsed(d time.Duration) string {
	sec := int(d.Seconds())
	if sec < 60 {
		return locales.Seconds(fmt.Sprint(max(sec, 0)))
	}
	if sec < 3600 {
		return locales.Minutes(fmt.Sprint(sec/60), fmt.Sprintf("%02d", sec%60))
	}
	return locales.Hours(fmt.Sprint(sec/3600), fmt.Sprintf("%02d", sec/60%60))

}
