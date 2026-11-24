package shell

import (
	"slices"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

func (s *Shell) modelsOf(kind agent.Kind, demand workbench.ModelDemand) workbench.ModelList {
	var source workbench.ModelSource
	if r := s.opts.Agents; r != nil {
		st := r.Status(kind)
		switch {
		case st.State == agents.Checking:
			return workbench.ModelList{Loading: true}
		case st.Problem == agents.ProblemUnknown:
			// Demo and test Agents are provided directly by the workbench.
		case !st.Usable():
			return workbench.ModelList{Err: &agents.UnusableError{Status: st}}
		default:
			source = workbench.ModelSource{Path: st.Path, Version: st.Version, Auth: st.Auth, SignedOut: st.State == agents.NotLoggedIn}
		}
	}
	return s.wb.ModelList(kind, source, demand)
}

// modelState is the composer's model and effort menus.
type modelState struct {
	models, efforts bool
}

// using is the model and the effort a session runs on, as far as known:
// what was chosen, else what the Agent says it uses; m is the model of
// the list, if it is there.
type using struct {
	name, effort string
	m            *agent.Model
}

func modelInUse(x model.Session, st workbench.Status, list []agent.Model) using {
	u := using{effort: x.Effort}
	if u.effort == "" {
		u.effort = st.Effort
	}
	id := x.Model
	if id == "" {
		id = st.Model
	}
	// The model chosen by its ID; the one the Agent reported by what it
	// runs as, a named model rather than the default that runs as it.
	for i := range list {
		if m := &list[i]; m.ID == x.Model && x.Model != "" || x.Model == "" && m.Runs(st.Model) && (u.m == nil || m.ID != "") {
			u.m = m
		}
	}
	switch {
	case u.m != nil:
		u.name = u.m.Name
	case id != "":
		u.name = id
	default:
		u.name = locales.DefaultModel()
	}
	return u
}

// modelControls are the composer's model and reasoning effort: menus
// while no turn runs, which change them from the next turn on.
func (s *Shell) modelControls(c *ui.Context, x model.Session, running bool) {
	t := c.Theme()
	st := &s.modelMenu
	status := s.wb.Status(x.ID)
	canList := s.wb.TellsModels(x.Agent)
	var ms workbench.ModelList
	if canList {
		demand := workbench.PeekModels
		if st.models || x.Model != "" || status.Model != "" {
			demand = workbench.LoadModels
		}
		ms = s.modelsOf(x.Agent, demand)
	}
	u := modelInUse(x, status, ms.Models)
	tip := func(what string) string {
		if running {
			return locales.ChangeAfter(what)
		}
		return locales.ClickToChange(what)
	}
	chip := func(symbol, text, label, tooltip string, enabled bool) ui.Element {
		b := ui.Row(c).Gap(4).Padding(4, 8).Radius(8).AlignItems(ui.Center).Label(label).Tooltip(tooltip).Children(func() {
			icon(c, symbol).Size(13).Color(t.TextMuted)
			ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
		})
		if !enabled {
			b.Opacity(0.5)
		} else if b.Hovered() {
			b.Background(t.SurfaceHover)
		}
		return b
	}
	if !canList {
		// The Agent tells no models: what it uses, unchangeable.
		chip("cpu", u.name, locales.ModelLabel(u.name), locales.ModelHeading(), false)
		return
	}
	mb := chip("cpu", u.name, locales.ModelLabel(u.name), tip(locales.ModelWord()), !running)
	if mb.Clicked() && !running {
		st.models, st.efforts = !st.models, false
		if st.models {
			demand := workbench.LoadModels
			if ms.Err != nil {
				demand = workbench.RetryModels
			}
			ms = s.modelsOf(x.Agent, demand)
		}
	}
	if running {
		st.models, st.efforts = false, false
	}
	ui.Popover(c, mb, &st.models, func() {
		ui.Column(c).Width(320).Gap(2).Padding(8).Children(func() {
			ui.Text(c, locales.ModelHeading()).Bold().TextColor(t.Text).Padding(0, 6, 4)
			switch {
			case ms.Loading:
				ui.Text(c, locales.ModelsLoading()).FontSize(12).TextColor(t.TextMuted).Padding(4, 6)
			case ms.Err != nil:
				ui.Text(c, withDetail(locales.ModelsFailed(), s.say(ms.Err))).FontSize(11).TextColor(t.Warning).Padding(4, 6)
			}
			for _, m := range ms.Models {
				if pickRow(c, "m"+m.ID, locales.UseModel(m.Name), func() {
					symbol := "circle"
					if u.m != nil && u.m.ID == m.ID {
						symbol = "checkmark.circle.fill"
					}
					icon(c, symbol).Size(14).Color(t.Accent)
					ui.Column(c).Grow(1).Children(func() {
						ui.Text(c, m.Name).TextColor(t.Text)
						if m.Description != "" {
							ui.Text(c, m.Description).FontSize(11).TextColor(t.TextMuted).MaxLines(2)
						}
					})
				}).Clicked() {
					s.setModel(x, m, x.Effort)
					st.models = false
				}
			}
		})
	})
	if u.m == nil || len(u.m.Efforts) == 0 {
		return // the model takes no effort, or which it takes is unknown
	}
	effort := u.effort
	if effort == "" {
		effort = locales.ModeDefault()
	}
	eb := chip("gauge.with.dots.needle.33percent", effort, locales.EffortLabel(effort), tip(locales.EffortWord()), !running)
	if eb.Clicked() && !running {
		st.efforts, st.models = !st.efforts, false
	}
	ui.Popover(c, eb, &st.efforts, func() {
		ui.Column(c).Width(200).Gap(2).Padding(8).Children(func() {
			ui.Text(c, locales.EffortHeading()).Bold().TextColor(t.Text).Padding(0, 6, 4)
			for _, e := range u.m.Efforts {
				if pickRow(c, "e"+e, locales.EffortRow(e), func() {
					symbol := "circle"
					if e == u.effort {
						symbol = "checkmark.circle.fill"
					}
					icon(c, symbol).Size(14).Color(t.Accent)
					ui.Text(c, e).TextColor(t.Text).Grow(1)
					if e == u.m.DefaultEffort {
						ui.Text(c, locales.ModeDefault()).FontSize(11).TextColor(t.TextMuted)
					}
				}).Clicked() {
					s.setModel(x, *u.m, e)
					st.efforts = false
				}
			}
		})
	})
}

// setModel puts x on model m with effort, or, when m takes no such
// effort, its default one.
func (s *Shell) setModel(x model.Session, m agent.Model, effort string) {
	if effort != "" && !slices.Contains(m.Efforts, effort) {
		effort = m.DefaultEffort
	}
	if err := s.wb.SetModel(x.ID, m.ID, effort); err != nil {
		s.notice = s.failed(locales.ModelFailed, err)
	}
}
