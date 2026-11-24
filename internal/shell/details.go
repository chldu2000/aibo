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
	open       bool
	session    string
	page       string
	selected   string
	workspaces map[string]*workspacePanel
	// confirming is a dangerous mode waiting for a second click.
	confirming string
}

func (s *Shell) closeDetails(id string) {
	s.detail.open, s.detail.confirming = false, ""
	s.detail.page, s.detail.selected = "", ""
	s.focusComposer = id
}

// inspector keeps its navigation visible while the selected content scrolls.
func (s *Shell) inspector(c *ui.Context, panel ui.Element, x model.Session) {
	panel.Radius(16).Clip().Material(glass.Glass{}).Padding(12).Gap(8).Children(func() {
		ui.Row(c).AlignItems(ui.Center).Children(func() {
			title := locales.SessionDetails()
			if s.detail.page != "" {
				title = s.inspectorTitle()
				if iconButton(c, "chevron.left", locales.Back()).Clicked() {
					if s.detail.page == "files" && s.workspacePanel(x.WorkspaceID).file != "" {
						s.workspacePanel(x.WorkspaceID).file = ""
					} else if s.detail.selected != "" {
						s.detail.selected = ""
					} else {
						s.detail.page = ""
					}
				}
			}
			ui.Text(c, title).Bold().TextColor(c.Theme().Text).Grow(1)
			if iconButton(c, "xmark", locales.DetailsClose()).Clicked() {
				s.closeDetails(x.ID)
			}
		})
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
		ui.Row(c).Gap(6).Wrap().Children(func() {
			if ui.Button(c, locales.CommandHistory()).Clicked() {
				s.openActivities(x.ID, workbench.Commands, false)
			}
			if ui.Button(c, locales.DelegationHistory()).Clicked() {
				s.openActivities(x.ID, workbench.Delegations, false)
			}
			if ui.Button(c, locales.WorkspaceFiles()).Clicked() {
				s.detail.page = "files"
			}
			if ui.Button(c, locales.GitStatus()).Clicked() {
				s.detail.page = "git"
			}
		})
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
