package shell

import (
	"context"
	"errors"
	"github.com/chldu2000/aibo/locales"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// pathsPref is the preference that keeps the executables the user chose.
const pathsPref = "agentPaths"

// stateText names an Agent's standing in a word or two.
func stateText(s agents.Status) string {
	switch s.State {
	case agents.Checking:
		return locales.StateChecking()
	case agents.NotInstalled:
		return locales.StateNotInstalled()
	case agents.TooOld:
		return locales.StateTooOld()
	case agents.Broken:
		return locales.StateBroken()
	case agents.NotLoggedIn:
		return locales.StateSignedOut()
	}
	return locales.StateReady()
}

// sourceText says how an Agent's executable was found.
func sourceText(src agents.Source) string {
	switch src {
	case agents.SourceSettings:
		return locales.SourceSettings()
	case agents.SourceCommon:
		return locales.SourceCommon()
	case agents.SourcePath:
		return locales.SourcePath()
	}
	return ""
}

// agentOK tells whether a session can start with the Agent, and why not.
// describe is what aibo knows of an Agent (agents.Spec); for one it does
// not support, as the fake, its name alone.
func (s *Shell) describe(kind agent.Kind) agents.Spec {
	if s.opts.Agents != nil {
		if st := s.opts.Agents.Status(kind); st.Problem != agents.ProblemUnknown {
			return st.Spec
		}
	}
	if d, ok := agents.Describe(kind); ok {
		return d
	}
	return agents.Spec{Kind: kind, Name: s.agentName(kind)}
}

func (s *Shell) agentOK(kind agent.Kind) (bool, string) {
	if s.opts.Agents == nil {
		return true, ""
	}
	st := s.opts.Agents.Status(kind)
	if st.State == agents.Checking {
		return true, ""
	}
	return st.Usable(), problem(st)
}

// agentSettings is the settings' Agent page: each Agent as aibo found it,
// and what can be done about it.
func (s *Shell) agentSettings(c *ui.Context) {
	t := c.Theme()
	r := s.opts.Agents
	if r == nil {
		ui.Text(c, locales.NoDetection()).TextColor(t.TextMuted)
		return
	}
	if form := s.settings.addAgent; form != nil {
		s.addAgentForm(c, form)
		return
	}
	ui.Row(c).Gap(6).Wrap().Children(func() {
		if ui.Button(c, locales.AddAgent()).Disabled(s.agentChangeBusy).Clicked() {
			s.settings.addAgent = &agentForm{prefix: agents.DefaultToolPrefix}
		}
		for _, id := range agents.BuiltinACP() {
			d, _ := agents.Describe(id)
			if _, ok := r.ACPConfig(id); !ok && ui.Button(c, locales.RestoreACP(d.Name)).Disabled(s.agentChangeBusy).Clicked() {
				s.changeACP(nil, id, func() (agent.Agent, error) { return r.RestoreACP(id) })
			}
		}
	})
	if s.settings.agentErr != "" {
		ui.Text(c, s.settings.agentErr).TextColor(t.Warning)
	}
	for _, st := range r.Statuses() {
		ui.Column(c).Key(string(st.Kind)).Gap(6).Padding(12).Radius(12).Background(t.Surface).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				s.agentGlyph(c, st.Kind, 18)
				ui.Text(c, st.Name).Bold().TextColor(t.Text).Grow(1)
				color := t.Success
				if st.State != agents.Ready {
					color = t.Warning
				}
				ui.Text(c, stateText(st)).FontSize(12).Bold().TextColor(color)
			})
			if st.Path != "" {
				ui.Text(c, locales.PathFrom(st.Path, sourceText(st.Source))).Font("Menlo").FontSize(11).TextColor(t.TextMuted).Selectable()
			}
			if st.Version != "" {
				line := locales.AgentVersion(st.Version)
				if st.Auth != "" {
					line = locales.AgentSignedIn(line, st.Auth)
				}
				ui.Text(c, line).FontSize(12).TextColor(t.Text)
			}
			if why := problem(st); why != "" && st.State != agents.Checking {
				ui.Text(c, why).FontSize(12).TextColor(t.Warning)
			}
			if st.State == agents.NotLoggedIn {
				switch s.describe(st.Kind).Login {
				case agents.LoginTerminal:
					s.terminalLogin(c, st)
				case agents.LoginInApp:
					s.appLogin(c, st.Kind)
				}
			}
			ui.Row(c).Gap(6).Wrap().Children(func() {
				if st.State == agents.NotInstalled && st.InstallURL != "" && s.opts.OpenURL != nil && ui.Button(c, locales.InstallGuide()).Clicked() {
					s.opts.OpenURL(st.InstallURL)
				}
				cfg, editable := r.ACPConfig(st.Kind)
				if editable && ui.Button(c, locales.EditACP()).Label(locales.EditACPLabel(st.Name)).Disabled(s.agentChangeBusy).Clicked() {
					s.settings.addAgent = editAgentForm(cfg)
				}
				if !editable && s.opts.ChooseFile != nil && ui.Button(c, locales.ChoosePath()).Clicked() {
					s.choosePath(st.Kind)
				}
				if _, chosen := r.Paths()[st.Kind]; !editable && chosen && ui.Button(c, locales.AutoPath()).Clicked() {
					s.setPath(st.Kind, "")
				}
				if ui.Button(c, locales.Recheck()).Label(locales.RecheckAgent(st.Name)).Disabled(st.State == agents.Checking).Clicked() {
					go r.Check(context.Background(), st.Kind)
				}
				// Removing goes last and in the danger color, as deleting a
				// session does.
				if editable && ui.Button(c, locales.RemoveACP()).Label(locales.RemoveACPLabel(st.Name)).TextColor(t.Danger).Disabled(s.agentChangeBusy).Clicked() {
					form := editAgentForm(cfg)
					form.removing = true
					s.settings.addAgent = form
				}
			})
		})
	}
	ui.Text(c, locales.AgentsNote()).FontSize(11).TextColor(t.TextMuted)
}

// terminalLogin says how to sign in to an Agent in its own terminal
// flow, which aibo does not stand in for.
func (s *Shell) terminalLogin(c *ui.Context, st agents.Status) {
	t := c.Theme()
	d := s.describe(st.Kind)
	ui.Text(c, locales.TerminalLogin(d.Command, d.Name)).FontSize(12).TextColor(t.Text)
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, locales.CopyCommand()).Clicked() {
			c.WriteClipboard(st.Path)
		}
		if s.opts.OpenTerminal != nil && ui.Button(c, locales.OpenInTerminal(d.Command)).Clicked() {
			s.opts.OpenTerminal(st.Path)
		}
	})
}

// appLogin signs in to an Agent in aibo, through its own flow, as Codex
// with ChatGPT: in the browser, or with a device code.
func (s *Shell) appLogin(c *ui.Context, kind agent.Kind) {
	t := c.Theme()
	r := s.opts.Agents
	l := r.AppLogin(kind)
	start := func(device bool) {
		go func() {
			st, err := r.StartLogin(context.Background(), kind, device)
			if err == nil && !device && s.opts.OpenURL != nil {
				s.opts.OpenURL(st.AuthURL)
			}
		}()
	}
	switch {
	case l.Waiting && l.UserCode != "":
		ui.Text(c, locales.DeviceCodeHint()).FontSize(12).TextColor(t.Text)
		ui.Text(c, l.VerificationURL).Font("Menlo").FontSize(12).TextColor(t.Text).Selectable()
		ui.Text(c, l.UserCode).Font("Menlo").FontSize(18).Bold().TextColor(t.Text).Selectable()
		if ui.Button(c, locales.CancelLogin()).Clicked() {
			go r.CancelLogin(context.Background(), kind)
		}
	case l.Waiting:
		ui.Text(c, locales.WaitingBrowser()).FontSize(12).TextColor(t.Text)
		ui.Row(c).Gap(6).Children(func() {
			if s.opts.OpenURL != nil && ui.Button(c, locales.OpenBrowserAgain()).Clicked() {
				s.opts.OpenURL(l.AuthURL)
			}
			if ui.Button(c, locales.CancelLogin()).Clicked() {
				go r.CancelLogin(context.Background(), kind)
			}
		})
	default:
		if l.Error != "" {
			ui.Text(c, withDetail(locales.LoginFailed(), l.Error)).FontSize(12).TextColor(t.Warning)
		}
		ui.Row(c).Gap(6).Children(func() {
			if ui.PrimaryButton(c, locales.LoginChatGPT()).Clicked() {
				start(false)
			}
			if ui.Button(c, locales.LoginDeviceCode()).Clicked() {
				start(true)
			}
		})
		ui.Text(c, locales.ApiKeyHint()).FontSize(11).TextColor(t.TextMuted)
	}
}

func (s *Shell) choosePath(kind agent.Kind) {
	go func() {
		p, ok := s.opts.ChooseFile()
		if ok {
			s.later(func() { s.setPath(kind, p) })
		}
	}()
}

// setPath chooses an Agent's executable, kept with the data, and checks
// it.
func (s *Shell) setPath(kind agent.Kind, p string) {
	r := s.opts.Agents
	paths := r.Paths()
	if p == "" {
		delete(paths, kind)
	} else {
		paths[kind] = p
	}
	if err := s.wb.SetPref(pathsPref, paths); err != nil {
		s.notice = s.say(err)

	}
	go r.SetPath(context.Background(), kind, p)
}

// loginBanner says a session's Agent is signed out, how to sign in, and
// offers to send the last message again.
func (s *Shell) loginBanner(c *ui.Context, x model.Session, st workbench.Status) {
	r := s.opts.Agents
	signedOut := st.NeedsLogin
	if r != nil && r.Status(x.Agent).State == agents.NotLoggedIn {
		signedOut = true
	}
	if !signedOut {
		return
	}
	t := c.Theme()
	name := s.agentName(x.Agent)
	ui.Row(c).Gap(8).Padding(8, 12).Radius(14).AlignItems(ui.Center).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.25))}).Children(func() {
		d := s.describe(x.Agent)
		text := locales.AgentSignedOut(name)
		if d.HoldsSignedOut {
			text = locales.SignedOutHeld(name)
		}
		ui.Text(c, text).TextColor(t.Text).Grow(1)
		if d.Login == agents.LoginTerminal && r != nil && s.opts.OpenTerminal != nil {
			if ui.Button(c, locales.OpenInTerminal(d.Command)).Clicked() {
				s.opts.OpenTerminal(r.Status(x.Agent).Path)
			}
		}
		if ui.Button(c, locales.GoSignIn()).Clicked() {
			s.openSettings()
			s.settings.tab = agentsTab
		}
		if r != nil && ui.Button(c, locales.Recheck()).Label(locales.RecheckLogin()).Clicked() {
			go r.Check(context.Background(), x.Agent)
		}
		if st.NeedsLogin && ui.PrimaryButton(c, locales.Retry()).Clicked() {
			if err := s.wb.Retry(x.ID); err != nil && !errors.Is(err, agents.ErrNotLoggedIn) {
				s.notice = s.say(err)

			}
		}
	})
}

// agentsTab is the settings' Agent page.
const agentsTab = 1
