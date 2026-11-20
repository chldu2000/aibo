package shell

import (
	"fmt"
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
	sync    string // the sync service it is in, if any
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
			ui.Row(c).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "设置").Bold().FontSize(16).TextColor(t.Text).Grow(1)
				if iconButton(c, "xmark", "关闭设置").Clicked() {
					s.settings.open = false
				}
			})
			ui.Tabs(c, &s.settings.tab, "通用", "Agent", "高级")
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
		ui.Text(c, "数据目录").TextColor(t.Text)
		ui.Text(c, "会话、消息与引用都存在这里。可以改到方便找的位置，aibo 会把数据搬过去。").FontSize(11).TextColor(t.TextMuted)
		ui.Text(c, s.opts.DataDir).Font("Menlo").FontSize(12).TextColor(t.Text).Selectable().Padding(6, 8).Radius(8).Background(t.Surface)
		if m := s.settings.move; m != nil {
			s.confirmMove(c, m)
			return
		}
		ui.Row(c).Gap(6).Children(func() {
			if s.opts.ShowInFinder != nil && ui.Button(c, "在 Finder 中显示").Clicked() {
				s.opts.ShowInFinder(s.opts.DataDir)
			}
			if s.opts.MoveDataDir != nil && ui.Button(c, "更改…").Disabled(s.settings.moving).Clicked() {
				s.chooseDataDir()
			}
		})
		if s.settings.moving {
			ui.Text(c, "正在搬移数据，完成后 aibo 会重新启动……").FontSize(12).TextColor(t.TextMuted)
		}
		if s.settings.moveErr != "" {
			ui.Text(c, s.settings.moveErr).FontSize(12).TextColor(t.Warning)
		}
	})
	field(c, "新会话的默认审批档位", "已有会话的档位不变，可以在会话的输入框里单独调整。", func() {
		i := 0
		for k, l := range levels {
			if l.level == st.DefaultLevel {
				i = k
			}
		}
		names := make([]string, len(levels))
		for k, l := range levels {
			names[k] = l.name
		}
		if ui.Segmented(c, &i, names...).Label("新会话的默认审批档位（选择）").Changed() {
			st.DefaultLevel = levels[i].level
			s.saveSettings(st)
		}
	})
	if st.DefaultLevel == agent.FullAuto {
		ui.Text(c, "注意：新会话里 Agent 的所有操作都不会询问。").FontSize(11).TextColor(t.Warning)
	}
	field(c, "有待审批时发系统通知", "不在屏幕上的会话需要审批时提醒你。", func() {
		on := st.Notify
		if ui.Switch(c, &on).Label("有待审批时发系统通知（开关）").Changed() {
			st.Notify = on
			s.saveSettings(st)
		}
	})
}

// chooseDataDir asks for the folder to move the data to.
func (s *Shell) chooseDataDir() {
	for _, x := range s.wb.Sessions() {
		if s.wb.Status(x.ID).Running {
			s.settings.moveErr = "有会话正在运行。请先等它完成或停止，再更改数据目录。"
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
		m.sync, _ = appdata.SyncFolder(path)
		s.later(func() { s.settings.move = m })
	}()
}

// confirmMove says what moving the data to m.to means, and does it.
func (s *Shell) confirmMove(c *ui.Context, m *dataMove) {
	t := c.Theme()
	ui.Column(c).Gap(6).Padding(10, 12).Radius(12).Material(glass.Glass{Tint: tinted(c, ui.RGBA(255, 150, 0, 0.18))}).Children(func() {
		ui.Text(c, "改到："+m.to).Font("Menlo").FontSize(12).TextColor(t.Text)
		if m.hasData {
			ui.Text(c, "这个文件夹里已经有 aibo 的数据：aibo 将直接使用它，现在的数据原样留在原处。").FontSize(12).TextColor(t.Text)
		} else {
			ui.Text(c, "aibo 会把数据复制过去，校验无误后再删除原位置的数据，然后重新启动。").FontSize(12).TextColor(t.Text)
		}
		if m.sync != "" {
			ui.Text(c, "这个文件夹在 "+m.sync+" 里。同步软件在 aibo 写入时同步数据库，可能损坏数据，不建议放在这里。").FontSize(12).Bold().TextColor(t.Warning)
		}
		ui.Row(c).Gap(6).Children(func() {
			if ui.PrimaryButton(c, "确定更改").Clicked() {
				s.settings.move, s.settings.moving = nil, true
				go func() {
					if err := s.opts.MoveDataDir(m.to); err != nil {
						s.later(func() {
							s.settings.moving = false
							s.settings.moveErr = "更改数据目录失败：" + err.Error()
						})
					}
				}()
			}
			if ui.Button(c, "取消").Clicked() {
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
				ui.TextInput(c, v).Label(name + "（数值）").Width(90)
				ui.Text(c, unit).FontSize(12).TextColor(t.TextMuted)
			})
		})
	}
	num("read_reference 每页", "接收方 Agent 读引用时一页的大小（估算）。", &set.page, "token")
	num("分页里单条工具输出", "一页里每条工具调用的输出最多保留这么多，其余用 read_message 读。", &set.toolOutput, "token")
	num("read_message 每页", "读一条长消息时一页的大小。", &set.messagePage, "token")
	num("闲置自动断开", "会话这么久没有动静，就结束 Agent 进程；有待审批时不断开。", &set.idleMinutes, "分钟")
	if set.advancedErr != "" {
		ui.Text(c, set.advancedErr).FontSize(12).TextColor(t.Warning)
	}
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c)
		if ui.Button(c, "恢复默认").Clicked() {
			d := workbench.DefaultSettings
			st := s.wb.Settings()
			st.Budgets, st.IdleTimeout = d.Budgets, d.IdleTimeout
			if s.saveSettings(st) {
				s.openSettings()
				s.settings.tab = advancedTab
			}
		}
		if ui.PrimaryButton(c, "保存").Clicked() {
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
		set.advancedErr = fmt.Sprintf("%v：每页 1000–200000，单条输出 200 到每页大小之间，read_message 每页 1000–500000，闲置 1–1440 分钟。", err)
		return
	}
	set.advancedErr = ""
}

func (s *Shell) saveSettings(st workbench.Settings) bool {
	if err := s.wb.SetSettings(st); err != nil {
		s.notice = "保存设置失败：" + err.Error()
		return false
	}
	return true
}

// advancedTab is the settings' advanced page.
const advancedTab = 2
