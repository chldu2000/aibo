package shell

import (
	"fmt"
	"strings"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// row is a row of the conversation: the message at first, or the tool
// calls of group, which ended well and fold into one line.
type row struct {
	first int
	group []int // indexes into the messages; nil for one message
}

// messageRows folds the tool calls between two replies into a group; the
// running, waiting, failed and interrupted ones show after it, on their
// own. A lone call that ended well stays as it is. Choosing messages, or
// a highlight among the calls, leaves them as they are: a range is chosen
// and shown by its messages.
func messageRows(msgs []model.Message, choosing bool, highlight [2]int) []row {
	var rows []row
	for i := 0; i < len(msgs); {
		if choosing || msgs[i].Kind != model.ToolCall {
			rows = append(rows, row{first: i})
			i++
			continue
		}
		j := i
		for j < len(msgs) && msgs[j].Kind == model.ToolCall {
			j++
		}
		lit := false
		var ended, apart []int
		for k := i; k < j; k++ {
			lit = lit || highlight[0] > 0 && msgs[k].Seq >= highlight[0] && msgs[k].Seq <= highlight[1]
			if standsApart(msgs[k]) {
				apart = append(apart, k)
			} else {
				ended = append(ended, k)
			}
		}
		if lit || len(ended) < 2 {
			for k := i; k < j; k++ {
				rows = append(rows, row{first: k})
			}
		} else {
			rows = append(rows, row{first: ended[0], group: ended})
			for _, k := range apart {
				rows = append(rows, row{first: k})
			}
		}
		i = j
	}
	return rows
}

// standsApart tells the calls that stay out of a group, as the user may
// have to look at them: running, waiting, failed, interrupted, or denied.
func standsApart(m model.Message) bool {
	tl := m.Tool
	if tl == nil || m.State == model.Streaming || m.State == model.Interrupted || tl.IsError || tl.Declined || tl.Approval.Pending() {
		return true
	}
	return tl.Approval != nil && tl.Approval.Answer != nil && tl.Approval.Answer.Kind.Denies()
}

// callKind is what a tool call does, by its tool's name, for the eye: its
// symbol, its color, and how a group counts it.
type callKind struct {
	symbol string
	tint   ui.Color
	count  func(int) string
}

var callKinds = []callKind{
	{"doc.text", ui.RGBA(40, 120, 255, 1), locales.CallsRead},
	{"magnifyingglass", ui.RGBA(20, 160, 160, 1), locales.CallsSearch},
	{"pencil", ui.RGBA(230, 130, 0, 1), locales.CallsEdit},
	{"terminal", ui.RGBA(110, 110, 120, 1), locales.CallsRun},
	{"person.2", ui.RGBA(150, 80, 255, 1), locales.CallsDelegate},
	{"globe", ui.RGBA(20, 150, 90, 1), locales.CallsWeb},
	{"wrench", ui.RGBA(120, 120, 130, 1), locales.CallsOther},
}

// kindOf is the index in callKinds of what a tool does.
func kindOf(name string) int {
	switch strings.ToLower(name) {
	case "read", "read_file", "view", "notebookread":
		return 0
	case "grep", "glob", "search", "ls", "find", "list_files":
		return 1
	case "edit", "write", "multiedit", "apply_patch", "notebookedit", "str_replace":
		return 2
	case "bash", "shell", "exec":
		return 3
	case "agent", "task":
		return 4
	case "webfetch", "websearch", "fetch":
		return 5
	}
	return 6
}

// groupSummary counts a group's calls by what they do; the calls that
// tell the files they changed, by the files, each once.
func groupSummary(msgs []model.Message, group []int) string {
	counts := make([]int, len(callKinds))
	files := map[string]bool{}
	for _, i := range group {
		tl := msgs[i].Tool
		if len(tl.Changes) == 0 {
			counts[kindOf(tl.Name)]++
			continue
		}
		for _, ch := range tl.Changes {
			if !files[ch.Path] {
				files[ch.Path] = true
				counts[2]++
			}
		}
	}
	var parts []string
	for k, n := range counts {
		if n > 0 {
			parts = append(parts, callKinds[k].count(n))
		}
	}
	return strings.Join(parts, " · ")
}

// groupSymbols is how many symbols a group shows before it counts the
// others as one, which lists them all.
const groupSymbols = 24

// toolGroup is a group of calls: a tinted symbol for each, which opens
// its call under them, then a count of what they did, which lists them
// all. live is set while the turn goes on with the calls.
func (s *Shell) toolGroup(c *ui.Context, v *sessionView, group []int, live bool) {
	t := c.Theme()
	v.open.init()
	msgs := v.msgs
	first, last := msgs[group[0]].Seq, msgs[group[len(group)-1]].Seq
	key := fmt.Sprint("group/", first)
	span := locales.ToolGroupLabel(fmt.Sprint(first), fmt.Sprint(last))
	listed := v.open.tools[key]
	picked := v.open.picked[key]
	ui.Column(c).Gap(4).Children(func() {
		ui.Row(c).Key("symbols").Gap(3).Padding(2, 0).AlignItems(ui.Center).Wrap().Children(func() {
			for n, i := range group {
				if n == groupSymbols && !listed {
					more := ui.Text(c, fmt.Sprint("+", len(group)-n)).Key("more").FontSize(11).TextColor(t.TextMuted).Padding(0, 4).
						Cursor(ui.CursorPointer).Label(locales.ListCalls() + " " + span)
					if more.Clicked() {
						listed, picked = true, 0
					}
					break
				}
				m := msgs[i]
				k := callKinds[kindOf(m.Tool.Name)]
				chip := ui.Box(c).Key(m.Seq).Size(22, 22).Radius(6).AlignItems(ui.Center).Justify(ui.Center).
					Tooltip(toolLabel(m)).Label(toolLabel(m) + " #" + fmt.Sprint(m.Seq)).Cursor(ui.CursorPointer).
					Background(tinted(c, ui.RGBA(k.tint.R, k.tint.G, k.tint.B, 0.16))).Children(func() {
					icon(c, k.symbol).Size(12).Color(k.tint)
				})
				if m.Seq == picked && !listed {
					chip.BorderWidth(1.5).BorderColor(k.tint)
				}
				if chip.Clicked() {
					if picked == m.Seq && !listed {
						picked = 0
					} else {
						picked, listed = m.Seq, false
					}
				}
			}
			if live {
				ui.Spinner(c).FontSize(12).Margin(0, 4)
			}
			count := locales.ToolGroupCount(len(group))
			if live {
				count = locales.ToolGroupLive(len(group))
			}
			action := locales.ListCalls()
			if listed {
				action = locales.HideCalls()
			}
			summary := ui.Text(c, count+" · "+groupSummary(msgs, group)).Key("summary").FontSize(12).TextColor(t.TextMuted).Padding(0, 6).
				Cursor(ui.CursorPointer).Tooltip(action)
			if summary.Hovered() {
				summary.TextColor(t.Text)
			}
			if summary.Clicked() {
				listed, picked = !listed, 0
			}
		})
		for _, i := range group {
			if listed || msgs[i].Seq == picked {
				ui.Column(c).Key(msgs[i].Seq).Children(func() {
					s.tool(c, v, fmt.Sprint(msgs[i].Seq), fmt.Sprint(msgs[i].Seq), msgs[i])
				})
			}
		}
	})
	v.open.tools[key] = listed
	v.open.picked[key] = picked
}

// groupRow is a group's row in the conversation, aligned with the
// messages; what was marked after its calls follows it.
func (s *Shell) groupRow(c *ui.Context, v *sessionView, group []int, st workbench.Status, after map[int][]model.Marker, gutter bool, indent float32) {
	// The calls go on while the turn runs, not waiting on the user, and
	// nothing came after them.
	live := st.Running && st.Approvals == 0
	for k := group[len(group)-1] + 1; k < len(v.msgs) && live; k++ {
		live = v.msgs[k].Kind == model.ToolCall
	}
	ui.Row(c).Key(fmt.Sprint("group/", v.msgs[group[0]].Seq)).Gap(10).AlignItems(ui.Start).Padding(4).Children(func() {
		if gutter {
			ui.Box(c).Width(gutterWidth)
		}
		ui.Column(c).Grow(1).MinWidth(0).MaxWidth(820).Children(func() {
			s.toolGroup(c, v, group, live)
		})
	})
	for _, k := range group {
		for _, mk := range after[v.msgs[k].Seq] {
			divider(c, mk, indent)
		}
	}
}
