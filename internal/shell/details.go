package shell

import (
	"fmt"
	"runtime"
	"time"

	"github.com/chldu2000/aibo/locales"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// detailsUI is the session details panel.
type detailsUI struct {
	// width is how wide the panel stands beside the messages, kept as a
	// preference; resized is when it last moved, until it is kept.
	width      float32
	resized    time.Time
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

// closeDetails closes the panel. It keeps the page, to open on it again,
// but leaves what the page opened in itself.
func (s *Shell) closeDetails(id string) {
	s.closeChildHistory()
	s.detail.open, s.detail.confirming = false, ""
	s.detail.selected = ""
	s.focusComposer = id
}

// pagePref is the preference keeping the page the panel last showed.
const pagePref = "inspectorPage"

// showPage turns the panel to a page, leaving what the page that showed
// had opened, and keeps it for the next time the panel opens.
func (s *Shell) showPage(page string) {
	if page != s.detail.page {
		s.closeChildHistory()
		s.detail.page, s.detail.selected, s.detail.confirming = page, "", ""
		if err := s.wb.SetPref(pagePref, page); err != nil {
			s.notice = s.say(err)
		}
	}
}

// knownPage reports whether page is one of the panel's, as a kept
// preference may not be after an update.
func knownPage(page string) bool {
	for _, tab := range inspectorTabs {
		if tab.page == page {
			return true
		}
	}
	return false
}

// toggleDetails opens the panel on the page it last showed, or closes it.
func (s *Shell) toggleDetails(id string) {
	if s.detail.open {
		s.closeDetails(id)
	} else {
		s.detail.open = true
	}
}

// detailsKeys are the panel's shortcuts that work whether it shows or
// not: ⌥⌘I opens or closes it, and ⌘1 to ⌘5 open it on a page.
func (s *Shell) detailsKeys(c *ui.Context, id string) {
	if s.settings.open {
		return
	}
	if c.Shortcut(ui.Cmd|ui.Alt, ui.KeyI) {
		s.toggleDetails(id)
	}
	digits := [...]ui.Key{ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8, ui.Key9}
	for i, tab := range inspectorTabs[:min(len(inspectorTabs), len(digits))] {
		if c.Shortcut(ui.Cmd, digits[i]) {
			s.detail.open = true
			s.showPage(tab.page)
		}
	}
}

// inspectorTabs are the panel's pages, in the order of its tabs.
var inspectorTabs = []struct {
	page, symbol string
	label        func() string
}{
	{"", "info.circle", locales.DetailsOverview},
	{string(workbench.Commands), "terminal", locales.CommandHistory},
	{string(workbench.Delegations), "person.2", locales.DelegationHistory},
	{"files", "folder", locales.WorkspaceFiles},
	{"git", "arrow.triangle.branch", locales.GitStatus},
}

// inspector keeps its tabs visible while the selected content scrolls.
// The tabs switch pages; Back only leaves what a page opened in itself,
// a file, a change, a call or a child's history.
func (s *Shell) inspector(c *ui.Context, panel ui.Element, x model.Session) {
	t := c.Theme()
	panel.Radius(16).Clip().Material(glass.Glass{}).Padding(12).Gap(10).Children(func() {
		ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
			s.inspectorTabBar(c, x, panel.Bounds().W)
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
		scope := sessionTitle(x)
		if workspacePage(s.detail.page) {
			scope = locales.WorkspaceScope(workspaceName(s.workspaceOf(x)))
		}
		ui.Text(c, scope).FontSize(11).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().Padding(0, 4)
		if crumb := s.inspectorCrumb(x); crumb != "" {
			ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
				if iconButton(c, "chevron.left", locales.Back()).Clicked() {
					s.inspectorBack(x)
				}
				ui.Text(c, crumb).Bold().FontSize(13).TextColor(t.Text).MaxLines(1).TruncateMiddle().Grow(1).MinWidth(0)
				if rel, gone := s.shownPath(x); rel != "" {
					s.pathActions(c, x, rel, gone)
				}
			})
		}
		// A file or a diff fills the panel and scrolls in its own view; a
		// call scrolls above its output, which fills the rest.
		p := s.workspacePanel(x.WorkspaceID)
		body := ui.Scroll(c)
		_, call := s.selectedActivity(x)
		if s.detail.page == "files" && p.file != "" || s.detail.page == "git" && p.change != nil || call {
			body = ui.Column(c).Gap(8)
		}
		body.Key(string(s.detail.page) + "/" + s.detail.selected).Grow(1).MinHeight(0).Children(func() {
			switch s.detail.page {
			case "":
				s.details(c, x)
			case "files":
				s.filePage(c, x)
			case "git":
				s.gitPage(c, x.WorkspaceID)
			default:
				s.activityPage(c, x)
			}
		})
	})
}

// inspectorMotion slides the panel in from the right edge as it opens,
// and back out as it closes.
var inspectorMotion = ui.ElementTransition{
	Duration: 180 * time.Millisecond,
	Colors:   true,
	Enter:    &ui.Motion{X: 24},
	Exit:     &ui.Motion{X: 24},
}

// inspectorKeys gives the panel Esc, which leaves what a page opened or
// else closes the panel, and ⌘[, which goes back; not while a dialog, a
// menu, a selection or a confirmation has Esc for its own.
func (s *Shell) inspectorKeys(c *ui.Context, x model.Session, v *sessionView) {
	if s.settings.open || s.side.renaming != "" || s.side.deleting != "" || s.pull.open || v.sel.on || s.detail.confirming != "" {
		return
	}
	nested := s.inspectorCrumb(x) != ""
	switch {
	case c.Shortcut(0, ui.KeyEscape):
		if nested {
			s.inspectorBack(x)
		} else {
			s.closeDetails(x.ID)
		}
	case nested && c.Shortcut(ui.Cmd, ui.KeyBracketLeft):
		s.inspectorBack(x)
	}
}

// inspectorTabBar is a segmented control of symbols, named by their
// tooltips, on a faint track that reads on any glass.
func (s *Shell) inspectorTabBar(c *ui.Context, x model.Session, width float32) {
	t := c.Theme()
	cur := 0
	for i, tab := range inspectorTabs {
		if tab.page == s.detail.page {
			cur = i
		}
	}
	counts := s.tabCounts(x)
	sel := cur
	seg := ui.SegmentedBase(c.Key("inspector-tabs"), &sel, len(inspectorTabs))
	seg.Track.Padding(2).Gap(2).Radius(9).AlignItems(ui.Center).Background(veil(c, 0.06)).Label(locales.DetailsTabs()).Children(func() {
		for i, tab := range inspectorTabs {
			// The session's pages, then the workspace's.
			if i > 0 && workspacePage(tab.page) && !workspacePage(inspectorTabs[i-1].page) {
				ui.Box(c).Key("divider").Size(1, 16).Margin(0, 3).Background(veil(c, 0.15))
			}
			label := tab.label()
			// The name shows beside the chosen tab's symbol when there is
			// room; the count is not in the label, which stays the same.
			named := i == sel && width >= tabNamesWidth
			sg := seg.Segment(i).Height(26).Radius(7).AlignItems(ui.Center).Justify(ui.Center).Gap(5).Label(label).Tooltip(locales.WithShortcut(label, cmdKey(fmt.Sprint(i+1))))
			if named {
				sg.Padding(0, 9)
			} else {
				sg.Width(34)
			}
			ink := t.TextMuted
			switch {
			case i == sel:
				sg.Background(raised(c))
				ink = t.Text
			case sg.Hovered():
				sg.Background(veil(c, 0.08))
				ink = t.Text
			}
			sg.Children(func() {
				icon(c, tab.symbol).Size(15).Color(ink)
				if named {
					ui.Text(c, label).FontSize(12).TextColor(ink).NoWrap()
				}
				if n := counts[tab.page]; n > 0 {
					ui.Text(c, fmt.Sprint(n)).FontSize(9).Bold().TextColor(ui.RGBA(255, 255, 255, 1)).
						Absolute().Top(1).Right(1).Padding(0, 3).Radius(6).Background(t.Accent)
				}
			})
		}
	})
	if sel != cur {
		s.showPage(inspectorTabs[sel].page)
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
					if s.opts.ShowInFinder != nil && !ws.Missing && iconButton(c, "folder", showInLabel()).Clicked() {
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
					s.copyButton(c, locales.CopyNativeID(), id)
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

// tabNamesWidth is how wide the panel is for the chosen tab to show its
// name.
const tabNamesWidth = 360

// workspacePage tells the pages that follow the workspace, not the
// session.
func workspacePage(page string) bool { return page == "files" || page == "git" }

// tabCounts are the counts on the tabs, by page: the terminals and the
// subagents running, and the Git changes once the workspace is watched,
// as while the panel is open.
func (s *Shell) tabCounts(x model.Session) map[string]int {
	terminals, subagents := running(s.view(x.ID).msgs)
	counts := map[string]int{string(workbench.Commands): terminals, string(workbench.Delegations): subagents}
	if s.detail.watched == x.WorkspaceID {
		if r := s.wb.GitStatus(x.WorkspaceID); !r.Pending && r.Err == nil {
			counts["git"] = len(r.Value.Changes)
		}
	}
	return counts
}

// cmdKey is a shortcut with the platform's command key, as the user
// reads it: ⌘1 on macOS, Ctrl+1 elsewhere.
func cmdKey(key string) string {
	if runtime.GOOS == "darwin" {
		return "⌘" + key
	}
	return "Ctrl+" + key
}

// shiftCmdKey is cmdKey with Shift: ⇧⌘N on macOS, Ctrl+Shift+N elsewhere.
func shiftCmdKey(key string) string {
	if runtime.GOOS == "darwin" {
		return "⇧⌘" + key
	}
	return "Ctrl+Shift+" + key
}

// railPref is the preference keeping the panel's width beside the
// messages, one for all its pages.
const railPref = "inspectorWidth"

// The panel's width beside the messages, with its margin: as it starts and
// as a double click on its edge puts it back, and the least it takes. The
// messages keep messagesMin at the most.
const railWidth, railMin, messagesMin = 400, 300, 360

// railFor is the panel's width in a pane width wide: the user's, within
// what the pane leaves the messages.
func (s *Shell) railFor(width float32) float32 {
	return max(railMin, min(s.detail.width, width-messagesMin))
}

// railEdge is the panel's left edge, rail from the pane's right: dragged,
// it resizes the panel; double-clicked, it puts it back. The width is kept
// once it rests.
func (s *Shell) railEdge(c *ui.Context, rail, width float32) {
	edge := ui.Box(c).Key("inspector-edge").Absolute().Top(headerBottom + 8).Bottom(16).Right(rail - 3).Width(6).
		Cursor(ui.CursorResizeEW).Label(locales.ResizeDetails())
	now := c.Now()
	if edge.DoubleClicked() {
		s.detail.width, s.detail.resized = railWidth, now
	} else if dx, _, ok := edge.Dragged(); ok && dx != 0 {
		s.detail.width, s.detail.resized = s.railFor(width)-dx, now
		s.detail.width = s.railFor(width)
	}
	if s.detail.resized.IsZero() {
		return
	}
	if due := s.detail.resized.Add(widthRest); now.Before(due) {
		c.After(due.Sub(now))
		return
	}
	s.detail.resized = time.Time{}
	if err := s.wb.SetPref(railPref, s.detail.width); err != nil {
		s.notice = s.say(err)
	}
}
