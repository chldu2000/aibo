package shell

import (
	"context"
	"slices"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// models are the models an Agent told, loaded once.
type models struct {
	list    []agent.Model
	loading bool
	err     string
}

// modelsOf are an Agent's models, loading them the first time; nil while
// they load, or when the Agent does not tell.
func (s *Shell) modelsOf(kind agent.Kind) *models {
	if !s.wb.TellsModels(kind) {
		return nil
	}
	if s.models == nil {
		s.models = map[agent.Kind]*models{}
	}
	if m, ok := s.models[kind]; ok {
		return m
	}
	m := &models{loading: true}
	s.models[kind] = m
	go func() {
		list, err := s.wb.Models(context.Background(), kind)
		s.later(func() {
			m.loading, m.list = false, list
			if err != nil {
				m.err = err.Error()
			}
		})
	}()
	return m
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

func (s *Shell) using(x model.Session) using {
	var list []agent.Model
	if ms := s.modelsOf(x.Agent); ms != nil {
		list = ms.list
	}
	st := s.wb.Status(x.ID)
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
		u.name = "默认模型"
	}
	return u
}

// modelControls are the composer's model and reasoning effort: menus
// while no turn runs, which change them from the next turn on.
func (s *Shell) modelControls(c *ui.Context, x model.Session, running bool) {
	t := c.Theme()
	u := s.using(x)
	ms := s.modelsOf(x.Agent)
	tip := func(what string) string {
		if running {
			return "等这一轮结束后再换" + what
		}
		return what + "：点击更换"
	}
	chip := func(symbol, text, label, tooltip string, enabled bool) ui.Element {
		b := ui.Row(c).Gap(4).Padding(4, 8).Radius(8).AlignItems(ui.Center).Label(label).Tooltip(tooltip).Children(func() {
			sfsymbols.Symbol(c, symbol).Size(13).Color(t.TextMuted)
			ui.Text(c, text).FontSize(12).TextColor(t.TextMuted)
		})
		if !enabled {
			b.Opacity(0.5)
		} else if b.Hovered() {
			b.Background(t.SurfaceHover)
		}
		return b
	}
	if ms == nil {
		// The Agent tells no models: what it uses, unchangeable.
		chip("cpu", u.name, "模型："+u.name, "模型", false)
		return
	}
	st := &s.modelMenu
	mb := chip("cpu", u.name, "模型："+u.name, tip("模型"), !running)
	if mb.Clicked() && !running {
		st.models, st.efforts = !st.models, false
	}
	if running {
		st.models, st.efforts = false, false
	}
	ui.Popover(c, mb, &st.models, func() {
		ui.Column(c).Width(320).Gap(2).Padding(8).Children(func() {
			ui.Text(c, "模型").Bold().TextColor(t.Text).Padding(0, 6, 4)
			switch {
			case ms.loading:
				ui.Text(c, "正在读取模型列表……").FontSize(12).TextColor(t.TextMuted).Padding(4, 6)
			case ms.err != "":
				ui.Text(c, "读不到模型列表："+ms.err).FontSize(11).TextColor(t.Warning).Padding(4, 6)
			}
			for _, m := range ms.list {
				if pickRow(c, "m"+m.ID, "使用模型 "+m.Name, func() {
					symbol := "circle"
					if u.m != nil && u.m.ID == m.ID {
						symbol = "checkmark.circle.fill"
					}
					sfsymbols.Symbol(c, symbol).Size(14).Color(t.Accent)
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
		effort = "默认"
	}
	eb := chip("gauge.with.dots.needle.33percent", effort, "推理强度："+effort, tip("推理强度"), !running)
	if eb.Clicked() && !running {
		st.efforts, st.models = !st.efforts, false
	}
	ui.Popover(c, eb, &st.efforts, func() {
		ui.Column(c).Width(200).Gap(2).Padding(8).Children(func() {
			ui.Text(c, "推理强度").Bold().TextColor(t.Text).Padding(0, 6, 4)
			for _, e := range u.m.Efforts {
				if pickRow(c, "e"+e, "推理强度 "+e, func() {
					symbol := "circle"
					if e == u.effort {
						symbol = "checkmark.circle.fill"
					}
					sfsymbols.Symbol(c, symbol).Size(14).Color(t.Accent)
					ui.Text(c, e).TextColor(t.Text).Grow(1)
					if e == u.m.DefaultEffort {
						ui.Text(c, "默认").FontSize(11).TextColor(t.TextMuted)
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
		s.notice = "更换模型失败：" + err.Error()
	}
}
