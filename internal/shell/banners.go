package shell

import (
	"errors"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

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
