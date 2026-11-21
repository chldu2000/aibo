package shell

import (
	"fmt"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// Tools that run a terminal process, and that run a subagent, by the
// names the Agents give them.
var (
	terminalTools = map[string]bool{"Bash": true, "shell": true}
	subagentTools = map[string]bool{"Agent": true, "Task": true, "agent": true}
)

// running counts a session's tool calls still running that run terminal
// processes, and subagents: a subagent's own calls too.
func running(msgs []model.Message) (terminals, subagents int) {
	var count func(ms []model.Message)
	count = func(ms []model.Message) {
		for _, m := range ms {
			if m.Kind != model.ToolCall || m.Tool == nil || m.State != model.Streaming {
				continue
			}
			switch {
			case terminalTools[m.Tool.Name]:
				terminals++
			case subagentTools[m.Tool.Name]:
				subagents++
			}
			count(m.Children)
		}
	}
	count(msgs)
	return terminals, subagents
}

// chip is a badge in tinted glass, its text and symbol in the theme's
// color, so that it reads in the light and the dark.
func chip(c *ui.Context, symbol, text, label string, tint ui.Color) ui.Element {
	t := c.Theme()
	return ui.Row(c).Gap(6).Padding(5, 10).Radius(14).AlignItems(ui.Center).Label(label).Material(glass.Glass{Tint: tinted(c, tint)}).Children(func() {
		sfsymbols.Symbol(c, symbol).Size(12).Color(t.Text)
		ui.Text(c, text).FontSize(12).TextColor(t.Text)
	})
}

// Tints of the badges: blue for processes, purple for subagents, orange
// for what waits on the user, green for references, gray for actions.
var (
	tintTerminal = ui.RGBA(40, 120, 255, 0.55)
	tintSubagent = ui.RGBA(150, 80, 255, 0.55)
	tintApproval = ui.RGBA(255, 150, 0, 0.6)
	tintRefs     = ui.RGBA(20, 170, 120, 0.55)
	tintAction   = ui.RGBA(120, 120, 130, 0.45)
)

// badges are above the composer: how the session runs (hidden at zero)
// on the left, quick actions on the right.
func (s *Shell) badges(c *ui.Context, x model.Session, v *sessionView) {
	st := s.wb.Status(x.ID)
	terminals, subagents := running(v.msgs)
	refs := s.wb.Received(x.ID)
	ui.Row(c).Gap(6).AlignItems(ui.Center).Wrap().Children(func() {
		if terminals > 0 {
			chip(c, "terminal", fmt.Sprintf("%d 个终端进程", terminals), "终端进程", tintTerminal)
		}
		if subagents > 0 {
			chip(c, "person.2", fmt.Sprintf("%d 个子 Agent 运行中", subagents), "子 Agent", tintSubagent)
		}
		if st.Approvals > 0 {
			chip(c, "exclamationmark.shield", fmt.Sprintf("%d 个待审批", st.Approvals), "待审批", tintApproval)
		}
		if refs > 0 {
			chip(c, "paperclip", fmt.Sprintf("收到 %d 个引用", refs), "收到的引用", tintRefs)
		}
		ui.Spacer(c)
		if chip(c, "arrow.down.right.and.arrow.up.left", "压缩上下文", "压缩上下文", tintAction).Clicked() {
			if err := s.wb.Compact(x.ID); err != nil {
				s.notice = err.Error()
			}
		}
		if chip(c, "arrowshape.turn.up.right", "引用会话…", "引用会话", tintAction).Clicked() {
			s.startSelecting(v)
		}
	})
}
