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
		ui.Scroll(c).Key(string(s.detail.page) + "/" + s.detail.selected).Grow(1).MinHeight(0).Children(func() {
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

func (s *Shell) details(c *ui.Context, x model.Session) {
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
	ui.Column(c).Gap(12).Padding(4).Children(func() {
		kv("Agent", func() {
			text(s.agentName(x.Agent))
		})
		kv(locales.DetailModel(), func() {
			u := modelInUse(x, st, s.modelsOf(x.Agent, workbench.PeekModels).Models)
			line := u.name
			if u.effort != "" {
				line = locales.EffortLine(line, u.effort)
			}
			text(line)
			if st.Running {
				ui.Text(c, locales.ChangeAfterTurn()).FontSize(11).TextColor(t.TextMuted)
			}
		})
		kv(locales.DetailWorkspace(), func() {
			text(ws.Path)
			if ws.Missing {
				ui.Text(c, locales.FolderMissing()).FontSize(11).TextColor(t.Warning)
			}
		})
		kv(locales.DetailNative(), func() {
			var ids []string
			for _, id := range x.NativeIDs {
				if id != "" {
					ids = append(ids, id)
				}
			}
			switch {
			case len(ids) == 0:
				text(locales.NotStarted())
			default:
				text(ids[len(ids)-1])
				if len(ids) > 1 {
					ui.Text(c, locales.NativeCount(len(ids))).FontSize(11).TextColor(t.TextMuted)
				}
			}
			state := locales.ProcessIdle()
			if st.Connected {
				state = locales.ProcessRunning()
			}
			ui.Text(c, state).FontSize(11).TextColor(t.TextMuted)
		})
		kv(locales.DetailMode(), func() {
			s.detailsMode(c, x)
		})
		kv(locales.DetailRules(), func() {
			if len(x.Rules) == 0 {
				text(locales.None())
			}
			for i, r := range x.Rules {
				s.ruleRow(c, x.ID, i, r)
			}
		})
		kv(locales.DetailReadDirs(), func() {
			if len(x.ReadDirs) == 0 {
				text(locales.None())
			}
			for i, d := range x.ReadDirs {
				ui.Text(c, locales.ReadOnlyDir(d)).Key(i).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable()
			}
		})
		ui.Row(c).Gap(6).Wrap().Children(func() {
			if ui.Button(c, locales.Compact()).Disabled(st.Running).Clicked() {
				if err := s.wb.Compact(x.ID); err != nil {
					s.notice = s.say(err)

				}
			}
			if ui.Button(c, locales.RenameMenu()).Clicked() {
				s.side.renaming, s.side.newTitle = x.ID, x.Title
			}
			archive := locales.Archive()
			if x.Archived {
				archive = locales.Unarchive()
			}
			if ui.Button(c, archive).Clicked() {
				if err := s.wb.SetArchived(x.ID, !x.Archived); err != nil {
					s.notice = s.say(err)

				}
			}
			if ui.Button(c, locales.DeleteMenu()).TextColor(t.Danger).Clicked() {
				s.side.deleting = x.ID
			}
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
	if ui.Select(c, &name, names).Label(locales.ModeSelect()).Changed() {
		if m := byName[name]; m.Risk == agent.Danger {
			s.detail.confirming = m.ID
		} else {
			s.setMode(x.ID, m.ID)
		}
	}
	ui.Text(c, modeDescription(x.Agent, cur)).FontSize(11).TextColor(c.Theme().TextMuted)
}
