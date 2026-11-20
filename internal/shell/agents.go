package shell

import (
	"context"
	"errors"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
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
		return "正在检测"
	case agents.NotInstalled:
		return "未安装"
	case agents.TooOld:
		return "版本过低"
	case agents.Broken:
		return "无法使用"
	case agents.NotLoggedIn:
		return "未登录"
	}
	return "可用"
}

// agentOK tells whether a session can start with the Agent, and why not.
func (s *Shell) agentOK(kind agent.Kind) (bool, string) {
	if s.opts.Agents == nil {
		return true, ""
	}
	st := s.opts.Agents.Status(kind)
	if st.State == agents.Checking {
		return true, ""
	}
	return st.Usable(), st.Reason
}

// agentSettings is the settings' Agent page: each Agent as aibo found it,
// and what can be done about it.
func (s *Shell) agentSettings(c *ui.Context) {
	t := c.Theme()
	r := s.opts.Agents
	if r == nil {
		ui.Text(c, "没有接入 Agent 检测。").TextColor(t.TextMuted)
		return
	}
	for _, st := range r.Statuses() {
		ui.Column(c).Key(string(st.Kind)).Gap(6).Padding(12).Radius(12).Background(t.Surface).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				agentGlyph(c, st.Kind, 18)
				ui.Text(c, st.Name).Bold().TextColor(t.Text).Grow(1)
				color := t.Success
				if st.State != agents.Ready {
					color = t.Warning
				}
				ui.Text(c, stateText(st)).FontSize(12).Bold().TextColor(color)
			})
			if st.Path != "" {
				ui.Text(c, st.Path+"（"+st.Source+"）").Font("Menlo").FontSize(11).TextColor(t.TextMuted).Selectable()
			}
			if st.Version != "" {
				line := "版本 " + st.Version
				if st.Auth != "" {
					line += " · 已登录：" + st.Auth
				}
				ui.Text(c, line).FontSize(12).TextColor(t.Text)
			}
			if st.Reason != "" && st.State != agents.Checking {
				ui.Text(c, st.Reason).FontSize(12).TextColor(t.Warning)
			}
			switch {
			case st.State == agents.NotLoggedIn && st.Kind == claude.Kind:
				s.claudeLogin(c, st)
			case st.State == agents.NotLoggedIn && st.Kind == codex.Kind:
				s.codexLogin(c)
			}
			ui.Row(c).Gap(6).Wrap().Children(func() {
				if st.State == agents.NotInstalled && s.opts.OpenURL != nil && ui.Button(c, "查看安装说明").Clicked() {
					s.opts.OpenURL(st.InstallURL)
				}
				if s.opts.ChooseFile != nil && ui.Button(c, "选择其他可执行文件…").Clicked() {
					s.choosePath(st.Kind)
				}
				if _, chosen := r.Paths()[st.Kind]; chosen && ui.Button(c, "改回自动查找").Clicked() {
					s.setPath(st.Kind, "")
				}
				if ui.Button(c, "重新检测").Label("重新检测 " + st.Name).Disabled(st.State == agents.Checking).Clicked() {
					go r.Check(context.Background(), st.Kind)
				}
			})
		})
	}
	ui.Text(c, "aibo 只运行你本机安装的 Agent，不替你安装，也不经手它们的登录凭据。").FontSize(11).TextColor(t.TextMuted)
}

// claudeLogin says how to sign in to Claude Code: in its own terminal
// flow, which aibo does not stand in for.
func (s *Shell) claudeLogin(c *ui.Context, st agents.Status) {
	t := c.Theme()
	ui.Text(c, "请在终端里运行 claude 完成登录（或在 Claude Code 里输入 /login），完成后回来点“重新检测”。").FontSize(12).TextColor(t.Text)
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, "复制命令").Clicked() {
			c.WriteClipboard(st.Path)
		}
		if s.opts.OpenTerminal != nil && ui.Button(c, "在终端中打开 claude").Clicked() {
			s.opts.OpenTerminal(st.Path)
		}
	})
}

// codexLogin signs in to Codex with ChatGPT, through Codex's own flow:
// in the browser, or with a device code.
func (s *Shell) codexLogin(c *ui.Context) {
	t := c.Theme()
	r := s.opts.Agents
	l := r.CodexLogin()
	start := func(device bool) {
		go func() {
			st, err := r.StartCodexLogin(context.Background(), device)
			if err == nil && !device && s.opts.OpenURL != nil {
				s.opts.OpenURL(st.AuthURL)
			}
		}()
	}
	switch {
	case l.Waiting && l.UserCode != "":
		ui.Text(c, "在浏览器打开下面的网址，输入代码完成登录：").FontSize(12).TextColor(t.Text)
		ui.Text(c, l.VerificationURL).Font("Menlo").FontSize(12).TextColor(t.Text).Selectable()
		ui.Text(c, l.UserCode).Font("Menlo").FontSize(18).Bold().TextColor(t.Text).Selectable()
		if ui.Button(c, "取消登录").Clicked() {
			go r.CancelCodexLogin(context.Background())
		}
	case l.Waiting:
		ui.Text(c, "正在等待你在浏览器里完成登录……").FontSize(12).TextColor(t.Text)
		ui.Row(c).Gap(6).Children(func() {
			if s.opts.OpenURL != nil && ui.Button(c, "再次打开浏览器").Clicked() {
				s.opts.OpenURL(l.AuthURL)
			}
			if ui.Button(c, "取消登录").Clicked() {
				go r.CancelCodexLogin(context.Background())
			}
		})
	default:
		if l.Error != "" {
			ui.Text(c, l.Error).FontSize(12).TextColor(t.Warning)
		}
		ui.Row(c).Gap(6).Children(func() {
			if ui.PrimaryButton(c, "用 ChatGPT 登录（浏览器）").Clicked() {
				start(false)
			}
			if ui.Button(c, "设备码登录").Clicked() {
				start(true)
			}
		})
		ui.Text(c, "用 API Key 的话，请在终端运行 codex login --with-api-key。").FontSize(11).TextColor(t.TextMuted)
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
		s.notice = err.Error()
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
		text := name + " 未登录。"
		if x.Agent == codex.Kind {
			text += "消息不会发出，输入的内容会保留。"
		}
		ui.Text(c, text).TextColor(t.Text).Grow(1)
		if x.Agent == claude.Kind && r != nil && s.opts.OpenTerminal != nil {
			if ui.Button(c, "在终端中打开 claude").Clicked() {
				s.opts.OpenTerminal(r.Status(x.Agent).Path)
			}
		}
		if ui.Button(c, "去登录").Clicked() {
			s.openSettings()
			s.settings.tab = agentsTab
		}
		if r != nil && ui.Button(c, "重新检测").Label("重新检测登录").Clicked() {
			go r.Check(context.Background(), x.Agent)
		}
		if st.NeedsLogin && ui.PrimaryButton(c, "重试").Clicked() {
			if err := s.wb.Retry(x.ID); err != nil && !errors.Is(err, agents.ErrNotLoggedIn) {
				s.notice = err.Error()
			}
		}
	})
}

// agentsTab is the settings' Agent page.
const agentsTab = 1
