package shell

import (
	"github.com/chldu2000/aibo/locales"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// detailsUI is the session details panel.
type detailsUI struct {
	history    *childHistoryView
	open       bool
	session    string
	page       string
	selected   string
	workspaces map[string]*workspacePanel
	watched    string
	release    func()
	// confirming is a dangerous mode waiting for a second click.
	confirming string
}

func (s *Shell) closeDetails(id string) {
	s.closeChildHistory()
	s.detail.open, s.detail.confirming = false, ""
	s.detail.page, s.detail.selected = "", ""
	s.focusComposer = id
}

// inspectorTabs are the panel's pages, in the order of its tabs.
var inspectorTabs = []struct {
	page, symbol string
	label        func() string
}{
	{"", "info.circle", locales.DetailsOverview},
	{"files", "folder", locales.WorkspaceFiles},
	{"git", "arrow.triangle.branch", locales.GitStatus},
	{string(workbench.Commands), "terminal", locales.CommandHistory},
	{string(workbench.Delegations), "person.2", locales.DelegationHistory},
}

// inspector keeps its tabs visible while the selected content scrolls.
// The tabs switch pages; Back only leaves what a page opened in itself,
// a file, a change, a call or a child's history.
func (s *Shell) inspector(c *ui.Context, panel ui.Element, x model.Session) {
	t := c.Theme()
	panel.Radius(16).Clip().Material(glass.Glass{}).Padding(12).Gap(10).Children(func() {
		ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
			s.inspectorTabBar(c)
			ui.Spacer(c)
			if s.detail.page == "files" || s.detail.page == "git" {
				if iconButton(c, "arrow.clockwise", locales.WorkspaceRefresh()).Clicked() {
					s.wb.RefreshWorkspace(x.WorkspaceID)
				}
			}
			if iconButton(c, "xmark", locales.DetailsClose()).Clicked() {
				s.closeDetails(x.ID)
			}
		})
		if crumb := s.inspectorCrumb(x); crumb != "" {
			ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
				if iconButton(c, "chevron.left", locales.Back()).Clicked() {
					s.inspectorBack(x)
				}
				ui.Text(c, crumb).Bold().FontSize(13).TextColor(t.Text).MaxLines(1).TruncateMiddle().Grow(1).MinWidth(0)
			})
		}
		// A file or a diff fills the panel and scrolls in its own view.
		p := s.workspacePanel(x.WorkspaceID)
		body := ui.Scroll(c)
		if s.detail.page == "files" && p.file != "" || s.detail.page == "git" && p.change != nil {
			body = ui.Column(c).Gap(8)
		}
		body.Key(string(s.detail.page) + "/" + s.detail.selected).Grow(1).MinHeight(0).Children(func() {
			switch s.detail.page {
			case "":
				s.details(c, x)
			case "files":
				s.filePage(c, x.WorkspaceID)
			case "git":
				s.gitPage(c, x.WorkspaceID)
			default:
				s.activityPage(c, x)
			}
		})
	})
}

// inspectorTabBar is a segmented control of symbols, named by their
// tooltips, on a faint track that reads on any glass.
func (s *Shell) inspectorTabBar(c *ui.Context) {
	t := c.Theme()
	cur := 0
	for i, tab := range inspectorTabs {
		if tab.page == s.detail.page {
			cur = i
		}
	}
	sel := cur
	seg := ui.SegmentedBase(c.Key("inspector-tabs"), &sel, len(inspectorTabs))
	seg.Track.Padding(2).Gap(2).Radius(9).Background(veil(c, 0.06)).Label(locales.DetailsTabs()).Children(func() {
		for i, tab := range inspectorTabs {
			label := tab.label()
			sg := seg.Segment(i).Size(34, 26).Radius(7).AlignItems(ui.Center).Justify(ui.Center).Label(label).Tooltip(label)
			ink := t.TextMuted
			switch {
			case i == sel:
				sg.Background(raised(c))
				ink = t.Text
			case sg.Hovered():
				sg.Background(veil(c, 0.08))
				ink = t.Text
			}
			sg.Children(func() { icon(c, tab.symbol).Size(15).Color(ink) })
		}
	})
	if sel != cur {
		s.closeChildHistory()
		s.detail.page, s.detail.selected, s.detail.confirming = inspectorTabs[sel].page, "", ""
	}
}

// veil is a translucent wash of the text's color, a track or a hover on
// glass that lets the glass show.
func veil(c *ui.Context, alpha float32) ui.Color {
	if c.Theme().Dark {
		return ui.RGBA(255, 255, 255, alpha*1.5)
	}
	return ui.RGBA(0, 0, 0, alpha)
}

// raised is the chosen segment's face, lifted off its track.
func raised(c *ui.Context) ui.Color {
	if c.Theme().Dark {
		return ui.RGBA(255, 255, 255, 0.18)
	}
	return ui.RGBA(255, 255, 255, 0.9)
}

// inspectorCrumb names what the page opened in itself, if anything.
func (s *Shell) inspectorCrumb(x model.Session) string {
	switch s.detail.page {
	case "":
		return ""
	case "files":
		return s.workspacePanel(x.WorkspaceID).file
	case "git":
		if ch := s.workspacePanel(x.WorkspaceID).change; ch != nil {
			return changeName(*ch)
		}
		return ""
	}
	if s.detail.history != nil {
		return locales.ChildHistoryOpen()
	}
	if s.detail.selected != "" {
		return "#" + s.detail.selected
	}
	return ""
}

// inspectorBack leaves what the page opened, the innermost first.
func (s *Shell) inspectorBack(x model.Session) {
	p := s.workspacePanel(x.WorkspaceID)
	switch {
	case s.detail.history != nil:
		s.closeChildHistory()
	case s.detail.page == "files":
		p.file = ""
	case s.detail.page == "git":
		p.change = nil
	default:
		s.detail.selected = ""
	}
}

// details is the overview: what the session is, in the session's
// section, what runs it, in the runtime's, and what can be done with it.
func (s *Shell) details(c *ui.Context, x model.Session) {
	t := c.Theme()
	st := s.wb.Status(x.ID)
	ws := s.workspaceOf(x)
	text := func(s string) { ui.Text(c, s).FontSize(12).TextColor(t.Text).Selectable() }
	note := func(s string, ink ui.Color) { ui.Text(c, s).FontSize(11).TextColor(ink) }
	ui.Column(c).Gap(16).Children(func() {
		section(c, locales.DetailsSession(), func(kv func(string, func())) {
			kv("Agent", func() { text(s.agentName(x.Agent)) })
			kv(locales.DetailModel(), func() {
				u := modelInUse(x, st, s.modelsOf(x.Agent, workbench.PeekModels).Models)
				line := u.name
				if u.effort != "" {
					line = locales.EffortLine(line, u.effort)
				}
				text(line)
				if st.Running {
					note(locales.ChangeAfterTurn(), t.TextMuted)
				}
			})
			kv(locales.DetailWorkspace(), func() {
				ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
					ui.Text(c, ws.Path).FontSize(12).TextColor(t.Text).MaxLines(1).TruncateMiddle().Tooltip(ws.Path).Grow(1).Shrink(1).MinWidth(0)
					if s.opts.ShowInFinder != nil && !ws.Missing && iconButton(c, "folder", locales.ShowInFinder()).Clicked() {
						s.opts.ShowInFinder(ws.Path)
					}
				})
				if ws.Missing {
					note(locales.FolderMissing(), t.Warning)
				}
			})
			kv(locales.DetailMode(), func() { s.detailsMode(c, x) })
			kv(locales.DetailRules(), func() {
				if len(x.Rules) == 0 {
					note(locales.None(), t.TextMuted)
				}
				for i, r := range x.Rules {
					s.ruleRow(c, x.ID, i, r)
				}
			})
			kv(locales.DetailReadDirs(), func() {
				if len(x.ReadDirs) == 0 {
					note(locales.None(), t.TextMuted)
				}
				for i, d := range x.ReadDirs {
					ui.Text(c, locales.ReadOnlyDir(d)).Key(i).Font("Menlo").FontSize(11).TextColor(t.Text).MaxLines(1).TruncateMiddle().Tooltip(d).MinWidth(0)
				}
			})
		})
		section(c, locales.DetailsRuntime(), func(kv func(string, func())) {
			kv(locales.DetailNative(), func() {
				var ids []string
				for _, id := range x.NativeIDs {
					if id != "" {
						ids = append(ids, id)
					}
				}
				if len(ids) == 0 {
					note(locales.NotStarted(), t.TextMuted)
					return
				}
				id := ids[len(ids)-1]
				ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
					ui.Text(c, id).Font("Menlo").FontSize(11).TextColor(t.Text).MaxLines(1).TruncateMiddle().Tooltip(id).Selectable().Grow(1).Shrink(1).MinWidth(0)
					if iconButton(c, "doc.on.doc", locales.CopyNativeID()).Clicked() {
						c.WriteClipboard(id)
					}
				})
				if len(ids) > 1 {
					note(locales.NativeCount(len(ids)), t.TextMuted)
				}
			})
			kv(locales.DetailProcess(), func() {
				ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
					dot, state := t.TextMuted, locales.ProcessIdle()
					if st.Connected {
						dot, state = t.Success, locales.ProcessRunning()
					}
					ui.Box(c).Size(7, 7).Radius(3.5).Background(dot)
					ui.Text(c, state).FontSize(12).TextColor(t.Text).Grow(1).Shrink(1).MinWidth(0)
				})
			})
		})
		s.detailsActions(c, x, st.Running)
	})
}

// detailsActions lists what can be done with the session, the one that
// cannot be undone last, apart and in red.
func (s *Shell) detailsActions(c *ui.Context, x model.Session, running bool) {
	t := c.Theme()
	ui.Column(c).Gap(6).Children(func() {
		sectionTitle(c, locales.DetailsActions())
		ui.Column(c).Radius(10).Background(veil(c, 0.035)).Padding(4).Gap(1).Children(func() {
			if actionRow(c, "arrow.down.right.and.arrow.up.left", locales.Compact(), t.Text, running).Clicked() && !running {
				if err := s.wb.Compact(x.ID); err != nil {
					s.notice = s.say(err)
				}
			}
			if actionRow(c, "pencil", locales.RenameMenu(), t.Text, false).Clicked() {
				s.side.renaming, s.side.newTitle = x.ID, x.Title
			}
			archive, symbol := locales.Archive(), "archivebox"
			if x.Archived {
				archive, symbol = locales.Unarchive(), "tray.and.arrow.up"
			}
			if actionRow(c, symbol, archive, t.Text, false).Clicked() {
				if err := s.wb.SetArchived(x.ID, !x.Archived); err != nil {
					s.notice = s.say(err)
				}
			}
			hairline(c).Margin(3, 6)
			if actionRow(c, "trash", locales.DeleteMenu(), t.Danger, false).Clicked() {
				s.side.deleting = x.ID
			}
		})
	})
}

// section is a titled group of rows on a faint card, as macOS's settings
// group them, a hairline between rows; rows adds a row through kv, its
// name and what it holds.
func section(c *ui.Context, title string, rows func(kv func(string, func()))) {
	t := c.Theme()
	ui.Column(c).Key(title).Gap(6).Children(func() {
		sectionTitle(c, title)
		ui.Column(c).Radius(10).Background(veil(c, 0.035)).Padding(0, 12).Children(func() {
			first := true
			rows(func(name string, value func()) {
				if !first {
					hairline(c)
				}
				first = false
				ui.Row(c).Key(name).Gap(10).Padding(9, 0).AlignItems(ui.Start).Children(func() {
					ui.Text(c, name).FontSize(12).TextColor(t.TextMuted).Width(84).Shrink(0)
					ui.Column(c).Grow(1).MinWidth(0).Gap(3).Children(value)
				})
			})
		})
	})
}

func sectionTitle(c *ui.Context, title string) {
	ui.Text(c, title).Bold().FontSize(11).TextColor(c.Theme().TextMuted).Padding(0, 6)
}

// hairline divides the rows of a card.
func hairline(c *ui.Context) ui.Element {
	return ui.Box(c).Height(1).Background(veil(c, 0.07))
}

// actionRow is a row of an action list, its symbol and its name in ink,
// lit on hover.
func actionRow(c *ui.Context, symbol, label string, ink ui.Color, disabled bool) ui.Element {
	row := ui.Row(c).Key(symbol).Gap(10).Padding(7, 8).Radius(7).AlignItems(ui.Center).Label(label).Disabled(disabled).Children(func() {
		icon(c, symbol).Size(14).Color(ink)
		ui.Text(c, label).FontSize(13).TextColor(ink)
	})
	if !disabled && row.Hovered() {
		row.Background(veil(c, 0.06))
	}
	return row
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
	if ui.Select(c, &name, names).Label(locales.ModeSelect()).Changed() {
		if m := byName[name]; m.Risk == agent.Danger {
			s.detail.confirming = m.ID
		} else {
			s.setMode(x.ID, m.ID)
		}
	}
	ui.Text(c, modeDescription(x.Agent, cur)).FontSize(11).TextColor(c.Theme().TextMuted)
}
