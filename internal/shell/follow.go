package shell

import (
	"time"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/plugins/glass"
	"github.com/egoist/mygo/ui"
)

// follow is what a session's view knows of its end: what it held when
// the list last showed it, and whether more came since.
type follow struct {
	seen  [3]int
	fresh bool
}

// endMark sums up the end of the messages: how many there are, the last
// one's seq, and how much it holds, which grows as it streams.
func endMark(msgs []model.Message, running bool) [3]int {
	if len(msgs) == 0 {
		return [3]int{}
	}
	m := msgs[len(msgs)-1]
	size := len(m.Text) + len(m.Thinking) + len(m.Children)
	if m.Tool != nil {
		size += len(m.Tool.Output)
	}
	if running {
		size++
	}
	return [3]int{len(msgs), m.Seq, size}
}

// jumpToEnd is the round button that shows over the messages while the
// list is scrolled away from their end, marked while more came below; it
// and ⌘↓ (or ⌘End) scroll back there. A focused field takes those keys
// for its caret first.
func (s *Shell) jumpToEnd(c *ui.Context, v *sessionView, running bool, right, bottom float32) {
	t := c.Theme()
	mark := endMark(v.msgs, running)
	if v.list.AtEnd() || len(v.msgs) == 0 {
		v.follow = follow{seen: mark}
		return
	}
	if mark != v.follow.seen {
		v.follow.fresh = true
	}
	label := locales.JumpToEnd()
	if v.follow.fresh {
		label = locales.NewBelow()
	}
	label = locales.WithShortcut(label, cmdKey("↓"))
	b := ui.Box(c).Key("jump-to-end").Absolute().Right(right).Bottom(bottom).Size(34, 34).Radius(17).
		AlignItems(ui.Center).Justify(ui.Center).Material(glass.Glass{}).Tooltip(label).Label(label).Transition(jumpMotion).Children(func() {
		icon(c, "arrow.down").Size(14).Color(t.Text)
		if v.follow.fresh {
			ui.Box(c).Absolute().Top(3).Right(3).Size(8, 8).Radius(4).Background(t.Accent)
		}
	})
	if b.Clicked() || c.Shortcut(ui.Cmd, ui.KeyDown) || c.Shortcut(ui.Cmd, ui.KeyEnd) {
		v.list.ScrollToEnd()
	}
}

// jumpMotion fades the button in and out, rising a little as it comes.
var jumpMotion = ui.ElementTransition{
	Duration: 150 * time.Millisecond,
	Enter:    &ui.Motion{Y: 8},
	Exit:     &ui.Motion{Y: 8},
}
