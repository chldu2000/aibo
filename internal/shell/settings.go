package shell

import (
	"github.com/chldu2000/aibo/locales"
	"strconv"
	"strings"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/appdata"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// settingsUI is the global settings' modal.
type settingsUI struct {
	open bool
	tab  int
	// move is the data directory the user chose to move to, waiting for
	// confirmation; moving is set while it moves.
	move   *dataMove
	moving bool
	// moveErr is why the data directory could not change.
	moveErr string
	// The advanced tab's fields, as typed; err what was wrong with them.
	page, toolOutput, messagePage, idleMinutes string
	advancedErr                                string
}

// dataMove is a new data directory, and what moving there means.
type dataMove struct {
	to      string
	hasData bool
	// synced is set when it is in a sync service's folder, sync naming
	// the service, if known.
	synced bool
	sync   string
}

// openSettings opens the settings, the advanced fields as they are.
func (s *Shell) openSettings() {
	st := s.wb.Settings()
	s.settings = settingsUI{open: true, tab: s.settings.tab,
		page: strconv.Itoa(st.Budgets.Page), toolOutput: strconv.Itoa(st.Budgets.ToolOutput),
		messagePage: strconv.Itoa(st.Budgets.MessagePage), idleMinutes: strconv.Itoa(int(st.IdleTimeout / time.Minute))}
}

// settingsModal shows the global settings when open.
func (s *Shell) settingsModal(c *ui.Context) {
	if !s.settings.open {
		return
	}
	t := c.Theme()
	// Without the modal's own panel: the glass is the panel.
	ui.DialogBase(c, &s.settings.open, func(backdrop, panel ui.Element) {
		backdrop.Background(ui.RGBA(0, 0, 0, 0.25))
		panel.Radius(18).Shadow(0, 12, 40, 0, ui.RGBA(0, 0, 0, 0.3))
		ui.Column(c).Width(620).Gap(14).Padding(20).Radius(18).Material(glass.Glass{}).Children(func() {
			// The window still moves while the settings cover it.
			ui.Row(c).AlignItems(ui.Center).DragWindow().Children(func() {
				ui.Text(c, locales.Settings()).Bold().FontSize(16).TextColor(t.Text).Grow(1)
				if iconButton(c, "xmark", locales.CloseSettings()).Clicked() {
					s.settings.open = false
				}
			})
			ui.Tabs(c, &s.settings.tab, locales.TabGeneral(), locales.TabAgents(), locales.TabAdvanced())
			switch s.settings.tab {
			case 0:
				s.generalSettings(c)
			case agentsTab:
				s.agentSettings(c)
			default:
				s.advancedSettings(c)
			}
		})
	})
}

// field is a setting's row: its name and what explains it, beside its
// control.
func field(c *ui.Context, name, what string, control func()) {
	t := c.Theme()
	ui.Row(c).Gap(16).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).Gap(2).Children(func() {
			ui.Text(c, name).TextColor(t.Text)
			if what != "" {
				ui.Text(c, what).FontSize(11).TextColor(t.TextMuted)
			}
		})
		control()
	})
}

func (s *Shell) generalSettings(c *ui.Context) {
	t := c.Theme()
	st := s.wb.Settings()
	ui.Column(c).Gap(6).Children(func() {
		ui.Text(c, locales.DataDir()).TextColor(t.Text)
		ui.Text(c, locales.DataDirExplain()).FontSize(11).TextColor(t.TextMuted)
		ui.Text(c, s.opts.DataDir).Font("Menlo").FontSize(12).TextColor(t.Text).Selectable().Padding(6, 8).Radius(8).Background(t.Surface)
		if m := s.settings.move; m != nil {
			s.confirmMove(c, m)
			return
		}
		ui.Row(c).Gap(6).Children(func() {
			if s.opts.ShowInFinder != nil && ui.Button(c, locales.ShowInFinder()).Clicked() {
				s.opts.ShowInFinder(s.opts.DataDir)
			}
			if s.opts.MoveDataDir != nil && ui.Button(c, locales.Change()).Disabled(s.settings.moving).Clicked() {
				s.chooseDataDir()
			}
			if s.opts.OpenLogs != nil && ui.Button(c, locales.OpenLogs()).Tooltip(locales.OpenLogsTip()).Clicked() {
				s.opts.OpenLogs()
			}
		})
		if s.settings.moving {
			ui.Text(c, locales.Moving()).FontSize(12).TextColor(t.TextMuted)
		}
		if s.settings.moveErr != "" {
			ui.Text(c, s.settings.moveErr).FontSize(12).TextColor(t.Warning)
		}
	})
	ui.Column(c).Gap(6).Children(func() {
		ui.Text(c, locales.DefaultModes()).TextColor(t.Text)
		ui.Text(c, locales.DefaultModesExplain()).FontSize(11).TextColor(t.TextMuted)
		for _, a := range s.wb.Agents() {
			list := s.modesOf(a.Kind)
			if list == nil {
				continue
			}
			var names []string
			byName := map[string]string{}
			cur := ""
			for _, m := range list {
				if m.Unavailable != "" {
					continue
				}
				names = append(names, m.Name)
				byName[m.Name] = m.ID
				// None chosen is the Agent's default.
				if m.ID == st.DefaultModes[a.Kind] || cur == "" && st.DefaultModes[a.Kind] == "" && m.Default {
					cur = m.Name
				}
			}
			ui.Row(c).Key(string(a.Kind)).Gap(8).AlignItems(ui.Center).Children(func() {
				s.agentGlyph(c, a.Kind, 16)
				ui.Text(c, a.Name).FontSize(12).TextColor(t.Text).Grow(1)
				if ui.Select(c, &cur, names).Label(locales.DefaultModeOf(a.Name)).Changed() {
					modes := map[agent.Kind]string{}
					for k, v := range st.DefaultModes {
						modes[k] = v
					}
					modes[a.Kind] = byName[cur]
					st.DefaultModes = modes
					s.saveSettings(st)
				}
			})
			for _, m := range list {
				if m.ID == st.DefaultModes[a.Kind] && m.Risk == agent.Danger {
					ui.Text(c, locales.DefaultModeWarning(a.Name, modeDescription(a.Kind, m))).FontSize(11).TextColor(t.Warning)
				}
			}
		}
	})
	field(c, locales.MentionIgnored(), locales.MentionIgnoredExplain(), func() {
		on := st.MentionIgnored
		if ui.Switch(c, &on).Label(locales.MentionIgnoredSwitch()).Changed() {
			st.MentionIgnored = on
			s.saveSettings(st)
		}
	})
	field(c, locales.Notify(), locales.NotifyExplain(), func() {
		on := st.Notify
		if ui.Switch(c, &on).Label(locales.NotifySwitch()).Changed() {
			st.Notify = on
			s.saveSettings(st)
		}
	})
}

// chooseDataDir asks for the folder to move the data to.
func (s *Shell) chooseDataDir() {
	for _, x := range s.wb.Sessions() {
		if s.wb.Status(x.ID).Running {
			s.settings.moveErr = locales.MoveWhileRunning()
			return
		}
	}
	if s.opts.ChooseFolder == nil {
		return
	}
	go func() {
		path, ok := s.opts.ChooseFolder()
		if !ok {
			return
		}
		s.later(func() { s.settings.moveErr = "" })
		m := &dataMove{to: path, hasData: appdata.HasData(path)}
		m.sync, m.synced = appdata.SyncFolder(path)
		s.later(func() { s.settings.move = m })
	}()
}

// confirmMove says what moving the data to m.to means, and does it.
func (s *Shell) confirmMove(c *ui.Context, m *dataMove) {
	t := c.Theme()
	ui.Column(c).Gap(6).Padding(10, 12).Radius(12).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.18))}).Children(func() {
		ui.Text(c, locales.MoveTo(m.to)).Font("Menlo").FontSize(12).TextColor(t.Text)
		if m.hasData {
			ui.Text(c, locales.MoveHasData()).FontSize(12).TextColor(t.Text)
		} else {
			ui.Text(c, locales.MoveCopies()).FontSize(12).TextColor(t.Text)
		}
		if m.synced {
			text := locales.MoveSyncedUnknown()
			if m.sync != "" {
				text = locales.MoveSynced(m.sync)
			}
			ui.Text(c, text).FontSize(12).Bold().TextColor(t.Warning)
		}
		ui.Row(c).Gap(6).Children(func() {
			if ui.PrimaryButton(c, locales.ConfirmChange()).Clicked() {
				s.settings.move, s.settings.moving = nil, true
				go func() {
					if err := s.opts.MoveDataDir(m.to); err != nil {
						s.later(func() {
							s.settings.moving = false
							s.settings.moveErr = s.failed(locales.MoveFailed, err)
						})
					}
				}()
			}
			if ui.Button(c, locales.Cancel()).Clicked() {
				s.settings.move = nil
			}
		})
	})
}

func (s *Shell) advancedSettings(c *ui.Context) {
	t := c.Theme()
	set := &s.settings
	num := func(name, what string, v *string, unit string) {
		field(c, name, what, func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				ui.TextInput(c, v).Label(locales.NumberField(name)).Width(90)
				ui.Text(c, unit).FontSize(12).TextColor(t.TextMuted)
			})
		})
	}
	num(locales.BudgetPage(), locales.BudgetPageExplain(), &set.page, "token")
	num(locales.BudgetToolOutput(), locales.BudgetToolOutputExplain(), &set.toolOutput, "token")
	num(locales.BudgetMessagePage(), locales.BudgetMessagePageExplain(), &set.messagePage, "token")
	num(locales.IdleTimeout(), locales.IdleTimeoutExplain(), &set.idleMinutes, locales.UnitMinutes())
	if set.advancedErr != "" {
		ui.Text(c, set.advancedErr).FontSize(12).TextColor(t.Warning)
	}
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c)
		if ui.Button(c, locales.RestoreDefaults()).Clicked() {
			d := workbench.DefaultSettings
			st := s.wb.Settings()
			st.Budgets, st.IdleTimeout = d.Budgets, d.IdleTimeout
			if s.saveSettings(st) {
				s.openSettings()
				s.settings.tab = advancedTab
			}
		}
		if ui.PrimaryButton(c, locales.Save()).Clicked() {
			s.saveAdvanced()
		}
	})
}

// saveAdvanced saves the advanced fields, or says what is wrong.
func (s *Shell) saveAdvanced() {
	set := &s.settings
	parse := func(v string) int {
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return -1
		}
		return n
	}
	st := s.wb.Settings()
	st.Budgets = refs.Budgets{Page: parse(set.page), ToolOutput: parse(set.toolOutput), MessagePage: parse(set.messagePage)}
	st.IdleTimeout = time.Duration(parse(set.idleMinutes)) * time.Minute
	if err := s.wb.SetSettings(st); err != nil {
		set.advancedErr = locales.BudgetRanges(s.say(err))
		return
	}
	set.advancedErr = ""
}

func (s *Shell) saveSettings(st workbench.Settings) bool {
	if err := s.wb.SetSettings(st); err != nil {
		s.notice = s.failed(locales.SaveSettingsFailed, err)

		return false
	}
	return true
}

// advancedTab is the settings' advanced page.
const advancedTab = 2
