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
	s.reportViewing()
	if c.Shortcut(ui.Cmd, ui.KeyComma) {
		s.openSettings()
	}
	s.side.hidden = s.sidebarHidden(c)
	if s.opts.Only != "" {
		// A session's own window: its area alone.
		ui.Box(c).Fill().Background(c.Theme().Background).Children(func() {
			s.pane(c)
		})
		s.renameDialog(c)
		s.deleteDialog(c)
		return
	}
	if c.Shortcut(ui.Cmd, ui.KeyBackslash) {
		s.toggleSidebar(c)
	}
	s.side.hidden = s.sidebarHidden(c)
	s.settingsModal(c)
	var root ui.Element
	if s.side.hidden {
		root = ui.Box(c).Fill().Background(c.Theme().Background).Children(func() {
			s.pane(c)
		})
	} else {
		if micaSidebar(c) {
			c.Root().Background(ui.Transparent)
		}
		root = ui.Split(c, &s.split, func() {
			s.sidebar(c)
		}, func() {
			ui.Box(c).Fill().Margin(0, 0, 0, 4).Radius(14, 0, 0, 14).Clip().Background(c.Theme().Background).Children(func() {
				s.pane(c)
			})
		}).SplitReset(sidebarWidth).Fill()
		s.sidebarResized(c, root.Changed())
	}
	s.newSessionKeys(c)
	s.starterDialog(c)
	s.renameDialog(c)
	s.deleteDialog(c)
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
	if h := s.detail.history; h != nil && (!ok || !s.detail.open || s.detail.page != string(workbench.Delegations) || h.session != x.ID || h.activity != s.detail.selected) {
		s.closeChildHistory()
	}
	watched := ""
	// The panel open, its workspace is watched: its pages and the Git
	// tab's count read it.
	if ok && s.detail.open && !s.settings.open {
		watched = x.WorkspaceID
	}
	s.watchPanel(watched)
	if s.pull.open && (s.pull.in != s.current || !ok || s.settings.open) {
		s.pull = pull{}
	}
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
			if s.side.hidden && s.opts.Only == "" {
				ui.Row(c).Absolute().Top(headerTop).Left(max(float32(16), bar.Left+12)).Height(headerBottom-headerTop).Padding(0, 8).Radius(23).AlignItems(ui.Center).Material(glass.Glass{}).Children(func() {
					s.sidebarButton(c)
				})
			}
			s.windowCapsule(c)
		})
		return
	}
	v := s.view(x.ID)
	ws := s.workspaceOf(x)
	s.detailsKeys(c, x.ID)
	pane := ui.Box(c).Fill()
	width, _ := c.Size()
	if b := pane.Bounds(); b.W > 0 {
		width = b.W
	} else if !s.side.hidden {
		width -= s.split
	}
	if s.detail.session != x.ID {
		s.detail.session, s.detail.confirming = x.ID, ""
		s.detail.selected = ""
	}
	pane.Children(func() {
		rail := float32(0)
		if s.detail.open && width >= 720 {
			rail = s.railFor(width)
		}
		// Chosen rows show in a light tint with the theme's text, not the
		// list's solid accent.
		th := *t
		if v.sel.on {
			th.Accent, th.AccentText = tinted(c, ui.RGBA(40, 120, 255, 0.28)), t.Text
		}
		ui.Themed(c, &th).Absolute().Top(0).Bottom(0).Left(0).Right(rail).Children(func() {
			ui.Column(c).Fill().Children(func() {
				s.messages(c, x, v, append(s.wb.Markers(x.ID), s.wb.TurnEnds(x.ID)...)).Grow(1)
			})
		})
		ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(80).PassThrough().Material(glass.ScrollEdge{})
		// The window moves by the floating header and the gap above it;
		// a session's own window, and the main one with the sidebar
		// hidden, have the traffic lights over its area, left of the
		// header, and move by that corner too. The messages under the
		// rest of the header's band still scroll.
		left := float32(16)
		if s.side.hidden {
			left = max(left, bar.Left+12)
			ui.Box(c).Absolute().Top(0).Left(0).Width(left).Height(headerBottom).DragWindow()
		}
		ui.Box(c).Absolute().Top(0).Left(0).Right(0).Height(headerTop).DragWindow()
		right := max(float32(16), bar.Right+12)
		if s.window != nil {
			right = capsuleRight + capsuleWidth + 8
		}
		ui.Row(c).Absolute().Top(headerTop).Left(left).Right(right).Height(headerBottom-headerTop).Radius(23).Clip().Padding(0, 16).Gap(10).AlignItems(ui.Center).Material(glass.Glass{}).DragWindow().Children(func() {
			if s.side.hidden && s.opts.Only == "" {
				s.sidebarButton(c)
			}
			s.agentGlyph(c, x.Agent, 20)
			ui.Text(c, sessionTitle(x)).Bold().TextColor(t.Text).MaxLines(1).Shrink(1).MinWidth(0)
			if x.Archived {
				// Unarchived from "…".
				ui.Text(c, locales.Archived()).FontSize(11).TextColor(t.TextMuted).NoWrap().Padding(1, 6).Radius(6).
					BorderWidth(1).BorderColor(t.Border).Tooltip(locales.ArchivedNote())
			}
			ui.Text(c, ws.Path).FontSize(12).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().Basis(0).Grow(1).MinWidth(0)
			if iconButton(c, "arrowshape.turn.up.right", locales.SelectMessages()).Clicked() {
				if v.sel.on {
					s.stopSelecting(v)
				} else {
					s.startSelecting(v)
				}
			}
			iconButton(c, "ellipsis", locales.SessionMore()).Menu(func(m *ui.Menu) { s.sessionMenu(m, x) })
			if iconButton(c, "sidebar.trailing", locales.SessionDetails()).Clicked() {
				s.toggleDetails(x.ID)
			}
		})
		s.windowCapsule(c)
		composer := ui.Column(c).Absolute().Bottom(16).Left(16).Right(16 + rail).Gap(8).Children(func() {
			s.banners(c, x.ID)
			// Approvals whose tool calls have not started yet.
			for _, a := range s.wb.LooseApprovals(x.ID) {
				s.approvalCard(c, x.ID, &a)
			}
			if v.sel.on {
				s.pull = pull{}
				s.selectionBar(c, x, v)
			} else {
				s.badges(c, x, v)
				s.composer(c, x, v)
			}
		})
		s.jumpToEnd(c, v, s.wb.Status(x.ID).Running, rail+24, bottomRoom(v.composerHeight)-8)
		if h := composer.Bounds().H; h != v.composerHeight {
			// The messages take the new room in the next frame.
			v.composerHeight = h
			c.After(0)
		}
		if s.detail.open {
			s.inspectorKeys(c, x, v)
		}
		if s.detail.open {
			panel := ui.Column(c).Absolute().Top(headerBottom + 8).Right(12).Bottom(16).Key("session-inspector").Transition(inspectorMotion)
			if rail > 0 {
				panel.Width(rail - 12)
				defer s.railEdge(c, rail, width)
			} else {
				panel.Left(16).Bottom(composer.Bounds().H + 24)
			}
			s.inspector(c, panel, x)
		}
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
	// The numbers take a column of their own only while they are needed,
	// to choose a range or to see the one highlighted; else a message's
	// shows over its corner while the pointer is on it.
	gutter := v.sel.on || v.highlight[0] > 0
	indent := float32(4)
	if gutter {
		indent += gutterWidth + 10
	}
	return ui.List(c, &v.list, n, func(i int) {
		if i >= len(v.msgs) {
			s.working(c, x, st, indent)
			return
		}
		m := v.msgs[i]
		if i == 0 {
			for _, mk := range after[0] {
				divider(c, mk, indent)
			}
		}
		defer func() {
			for _, mk := range after[m.Seq] {
				divider(c, mk, indent)
			}
		}()
		// In selection mode a press anywhere on a message chooses it,
		// rather than selecting its text or pressing its buttons.
		row := ui.Row(c).Gap(10).AlignItems(ui.Start).Padding(4).Radius(10).IgnoreInput(v.sel.on).Children(func() {
			if gutter {
				ui.Textf(c, "#%d", m.Seq).Key("seq").FontSize(11).TextColor(t.TextMuted).Width(gutterWidth).MaxLines(1)
			}
			// Keyed, the body stays the same element, its controls and
			// what they hold, as the number comes and goes beside it.
			defer func() {
				if !v.sel.on && v.hover == m.Seq {
					s.messageActions(c, x, v, m, !gutter)
				}
			}()
			ui.Column(c).Key("body").Grow(1).MinWidth(0).MaxWidth(820).Gap(6).Children(func() {
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
					if len(m.Attachments) > 0 {
						s.sentAttachments(c, m)
					}
					switch {
					case m.Command != nil:
						sentCommand(c, m)
					case m.Text != "":
						ui.Text(c, m.Text).Selectable().TextColor(t.Text).Padding(8, 12).Radius(12).Background(t.Surface)
					}
				case model.ToolCall:
					s.tool(c, v, fmt.Sprint(m.Seq), fmt.Sprint(m.Seq), m)
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
		// The number shows from the next frame.
		if hovered := row.Hovered(); hovered && v.hover != m.Seq {
			v.hover = m.Seq
			c.After(0)
		} else if !hovered && v.hover == m.Seq {
			v.hover = 0
			c.After(0)
		}
	}).Padding(76, 20, bottomRoom(v.composerHeight)).Gap(10).Children(func() {
		if len(v.msgs) == 0 {
			ui.Text(c, locales.StartConversation()).TextColor(t.TextMuted).Margin(ui.Auto)
		}
	})
}

// banners are notices above the composer, in tinted glass: first those
// that ask the user to decide (the native session cannot be resumed, the
// Agent is signed out, the folder is gone), then those that tell (a
// failure, a notice, a highlight). Past two, the first shows and the
// others fold into a line that opens them.
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
	v := s.views[id]
	type banner struct {
		key  string
		draw func()
	}
	var all []banner
	if st.ResumeFailed != nil {
		all = append(all, banner{"resume", func() { s.resumeBanner(c, id, st) }})
	}
	if ok && s.signedOut(x, st) {
		all = append(all, banner{"login", func() { s.loginBanner(c, x, st) }})
	}
	if ws := s.workspaceOf(x); ok && ws.Missing {
		all = append(all, banner{"missing", func() {
			ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
				ui.Text(c, locales.WorkspaceMissing(ws.Path)).TextColor(c.Theme().Text).Grow(1)
				if ui.Button(c, locales.Relocate()).Clicked() {
					s.relocate(ws)
				}
			})
		}})
	}
	var failure *workbench.Failure
	if errors.As(st.Error, &failure) {
		all = append(all, banner{"failure", func() { bar(s.sayFailure(s.agentName(x.Agent), failure), nil) }})
	}
	if s.notice != "" {
		all = append(all, banner{"notice", func() { bar(s.notice, func() { s.notice = "" }) }})
	}
	if v != nil && v.highlight[0] > 0 {
		all = append(all, banner{"highlight", func() {
			ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(40, 120, 255, 0.25))}).Children(func() {
				ui.Text(c, locales.Highlighted(refs.Range(v.highlight[0], v.highlight[1]))).TextColor(c.Theme().Text).Grow(1)
				if iconButton(c, "xmark", locales.ClearHighlight()).Clicked() {
					v.highlight = [2]int{}
				}
			})
		}})
	}
	if len(all) <= 2 && v != nil {
		v.bannersOpen = false
	}
	folded := len(all) > 2 && (v == nil || !v.bannersOpen)
	for i, b := range all {
		if folded && i > 0 {
			break
		}
		ui.Column(c).Key(b.key).Children(b.draw)
	}
	if len(all) <= 2 || v == nil {
		return
	}
	text, symbol := locales.MoreNotices(len(all)-1), "chevron.down"
	if !folded {
		text, symbol = locales.FewerNotices(), "chevron.up"
	}
	t := c.Theme()
	more := ui.Row(c).Key("more").Gap(6).Padding(6, 12).Radius(14).AlignItems(ui.Center).Label(text).Cursor(ui.CursorPointer).Material(glass.Glass{}).Children(func() {
		icon(c, symbol).Size(11).Color(t.TextMuted)
		ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
	})
	if more.Clicked() {
		v.bannersOpen = folded
	}
}

// composer is the glass input card: Enter sends, Shift+Enter breaks the
// line, and the round button sends or, while the Agent replies, stops.
func (s *Shell) composer(c *ui.Context, x model.Session, v *sessionView) {
	t := c.Theme()
	running := s.wb.Status(x.ID).Running
	drafts := s.wb.Drafts(x.ID)
	card := ui.Column(c).Gap(6).Padding(10, 12).Radius(18).Material(glass.Glass{})
	card.Children(func() {
		if v.command != nil || len(drafts) > 0 || len(v.mentions) > 0 || len(v.attachments) > 0 || v.attaching > 0 {
			ui.Row(c).Gap(6).Wrap().Children(func() {
				s.commandChip(c, v)
				s.draftAttachments(c, v)
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
		svc := c.Services()
		// Without a look of its own: the card's glass is the field. Keyed,
		// so that chips appearing above it keep its focus and caret.
		input := ui.TextAreaBase(c.Key("draft"+x.ID), &v.draft).Padding(4, 2).Placeholder(prompt).Label(prompt).MinHeight(44).MaxHeight(draftMaxHeight(c)).Disabled(blocked).OnPaste(func(text string) bool {
			if s.pasteFiles(svc, x.ID, text) {
				return true
			}
			v.pasted = true
			return false
		}).OnTextKey(func(k ui.TextKey) bool {
			if s.commandKey(x.ID, v, k) {
				return true
			}
			if k.Key != ui.KeyEnter || k.Mods != 0 {
				return false
			}
			if !running && v.attaching == 0 && (strings.TrimSpace(k.Text()) != "" || v.command != nil || len(drafts) > 0 || len(v.mentions) > 0 || len(v.attachments) > 0) && s.send(x.ID, k.Text()) {
				k.SetText("")
			}
			return true
		})
		if s.focusComposer == x.ID {
			input.Focus()
		}
		if v.caretEnd {
			input.SetTextSelection(1<<30, 1<<30)
			v.caretEnd = false
		}
		s.focusComposer = ""
		// Typing "@" opens the @ panel too; a paste with one does not.
		if at, ok := typedAt(v.typed, v.draft); ok && !v.pasted {
			s.openPull(x.ID, at)
		}
		v.typed, v.pasted = v.draft, false
		s.draftCommand(x, v)
		var atButton ui.Element
		toolbar := ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
			if s.opts.ChooseImages != nil && !blocked && iconButton(c, "paperclip", locales.Attach()).Clicked() {
				s.chooseImages(x.ID)
			}
			atButton = iconButton(c, "at", locales.MentionButton())
			if atButton.Clicked() {
				if s.pull.open {
					s.pull = pull{}
					input.Focus()
				} else {
					s.openPull(x.ID, -1)
				}
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
			empty := strings.TrimSpace(v.draft) == "" && v.command == nil && len(drafts) == 0 && len(v.mentions) == 0 && len(v.attachments) == 0 || v.attaching > 0
			if empty {
				bg = t.Border
			}
			if roundButton(c, "arrow.up", locales.Send(), bg, t.AccentText).Clicked() && !empty {
				if s.send(x.ID, v.draft) {
					v.draft = ""
				}
			}
		})
		if s.pull.open && (input.PressedInside() || toolbar.PressedInside() && !atButton.PressedInside()) {
			s.pull = pull{}
		}
		s.pullPanel(c, x, card)
		s.commandPanelView(c, x, v, card)
	})
	// Files dropped on the composer: images attached, others mentioned.
	if s.wb.Status(x.ID).ResumeFailed == nil {
		if dropped := card.DroppedFiles(); len(dropped) > 0 {
			s.givePaths(x.ID, dropped)
		}
		if card.FileDragOver() {
			card.BorderWidth(2).BorderColor(t.Accent)
		}
	}
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
// compacted its context, or a new native session took over. A command
// that said nothing, and how long a turn took, are lines of their own,
// under the last message.
func divider(c *ui.Context, mk model.Marker, indent float32) {
	t := c.Theme()
	switch mk.Kind {
	case model.CommandRan:
		ui.Text(c, locales.CommandRan()).FontSize(11).TextColor(t.TextMuted).Padding(0, 0, 0, indent)
		return
	case model.TurnEnded:
		text := locales.TurnTook(elapsed(mk.Took))
		if mk.Stopped {
			text = locales.TurnStopped(elapsed(mk.Took))
		}
		ui.Text(c, text).FontSize(11).TextColor(t.TextMuted).Padding(0, 0, 0, indent)
		return
	}
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
func (s *Shell) working(c *ui.Context, x model.Session, st workbench.Status, indent float32) {
	t := c.Theme()
	ui.Row(c).AlignItems(ui.Start).Padding(4, 4, 4, indent).Children(func() {
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

// bottomRoom is the room under the last message: the composer's height,
// with its margin from the window's edge and a gap above it. Before the
// composer was laid out, about what it takes alone.
func bottomRoom(composer float32) float32 {
	if composer <= 0 {
		return 170
	}
	return composer + 16 + 16
}

// draftMaxHeight is the most the composer's field grows to, 40% of the
// window, past which the draft scrolls in it.
func draftMaxHeight(c *ui.Context) float32 {
	_, h := c.Size()
	return max(44, h*0.4)
}

// gutterWidth is the width of the messages' numbers, in their column.
const gutterWidth = 44
