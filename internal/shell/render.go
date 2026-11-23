package shell

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/chldu2000/aibo/locales"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
	"github.com/egoist/mygo/ui/markdown"
)

// bigOutput is the size from which a tool's output shows in a read-only
// editor rather than as text.
const bigOutput = 4 << 10

// open remembers which disclosures of a session's messages are open.
type open struct {
	thinking map[int]bool
	tools    map[string]bool // by seq, and child index under it
	outputs  map[string]output
}

// output is a big tool output's editor, and the length it was made for.
type output struct {
	st *editor.State
	n  int
}

func (o *open) init() {
	if o.thinking == nil {
		o.thinking, o.tools, o.outputs = map[int]bool{}, map[string]bool{}, map[string]output{}
	}
}

// reply shows an Agent's reply: its reasoning folded above its text.
func (s *Shell) reply(c *ui.Context, v *sessionView, m model.Message) {
	t := c.Theme()
	v.open.init()
	if strings.TrimSpace(m.Thinking) != "" {
		o := v.open.thinking[m.Seq]
		ui.Collapsible(c, locales.Thinking(), &o, func() {
			ui.Text(c, m.Thinking).FontSize(12).TextColor(t.TextMuted).Selectable().Padding(0, 0, 0, 12)
		})
		v.open.thinking[m.Seq] = o
	}
	switch {
	case m.Text == "":
	case m.State == model.Streaming:
		markdown.Stream(c, m.Text, &s.md)
	default:
		markdown.View(c, m.Text, &s.md)
	}
}

// toolLabel is a tool call in one line: its name, the gist of its input,
// and how it is going.
func toolLabel(m model.Message) string {
	tl := m.Tool
	label := tl.Name + " · " + gist(tl.Input)
	switch {
	case m.State == model.Streaming:
		label = locales.ToolRunning(label)
	case m.State == model.Interrupted:
		label = locales.ToolInterrupted(label)
	case tl.IsError:
		label = locales.ToolFailed(label)
	}
	if n := len(m.Children); n > 0 {
		label = locales.ToolSteps(label, n)
	}
	return label
}

// gist is the input a tool call is mostly about: a path, a command, a
// pattern, a prompt; else its JSON, short.
func gist(input json.RawMessage) string {
	var in map[string]any
	if json.Unmarshal(input, &in) == nil {
		for _, k := range []string{"command", "file_path", "path", "pattern", "url", "query", "description", "prompt", "plan"} {
			if s, ok := in[k].(string); ok && s != "" {
				// A line break shows, so that "ls⏎cat x" does not read
				// as "ls cat x".
				return oneLine(strings.ReplaceAll(strings.TrimSpace(s), "\n", " ↵ "), 80)
			}
		}
	}
	return refs.Args(input, 80)
}

// tool shows a tool call, folded: open, its input, the subagent's steps
// and its result.
func (s *Shell) tool(c *ui.Context, v *sessionView, key string, m model.Message) {
	t := c.Theme()
	v.open.init()
	if m.Tool == nil {
		return
	}
	o := v.open.tools[key]
	defer func() {
		// The approval shows whether or not the call is open.
		if a := m.Tool.Approval; a != nil {
			s.approvalCard(c, s.current, a)
		}
	}()
	ui.Collapsible(c, toolLabel(m), &o, func() {
		ui.Column(c).Gap(6).Padding(4, 0, 4, 12).Children(func() {
			ui.Text(c, locales.ToolArgs()).FontSize(11).TextColor(t.TextMuted)
			ui.Text(c, pretty(m.Tool.Input)).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable()
			for i, ch := range m.Children {
				ui.Row(c).Key(i).Gap(6).AlignItems(ui.Start).Children(func() {
					sfsymbols.Symbol(c, "arrow.turn.down.right").Size(11).Color(t.TextMuted)
					ui.Column(c).Grow(1).Children(func() {
						if ch.Kind == model.ToolCall {
							s.tool(c, v, fmt.Sprintf("%s/%d", key, i), ch)
						} else {
							ui.Text(c, ch.Text).FontSize(12).TextColor(t.Text).Selectable()
						}
					})
				})
			}
			if !m.Tool.Done {
				return
			}
			label := locales.ToolResult()
			if m.Tool.IsError {
				label = locales.ToolResultError()
			}
			if m.Tool.Truncated {
				label = locales.ToolTruncated(label)
			}
			ui.Text(c, label).FontSize(11).TextColor(t.TextMuted)
			if len(m.Tool.Output) < bigOutput {
				ui.Text(c, strings.TrimRight(m.Tool.Output, "\n")).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable()
				return
			}
			out, ok := v.open.outputs[key]
			if !ok || out.n != len(m.Tool.Output) {
				out = output{st: &editor.State{Buffer: editor.NewBuffer(m.Tool.Output), ReadOnly: true}, n: len(m.Tool.Output)}
				v.open.outputs[key] = out
			}
			editor.View(c, out.st).Height(320).Radius(8)
		})
	})
	v.open.tools[key] = o
}

func pretty(input json.RawMessage) string {
	var b bytes.Buffer
	if json.Indent(&b, input, "", "  ") != nil {
		return string(input)
	}
	return b.String()
}

// plan shows a plan's steps, checked off as they are done.
func plan(c *ui.Context, m model.Message) {
	t := c.Theme()
	ui.Column(c).Gap(4).Padding(8, 12).Radius(12).Background(t.Surface).Children(func() {
		ui.Text(c, locales.PlanHeading()).FontSize(12).Bold().TextColor(t.TextMuted)
		for i, it := range m.Plan {
			ui.Row(c).Key(i).Gap(6).AlignItems(ui.Center).Children(func() {
				symbol, color := "circle", t.TextMuted
				switch it.Status {
				case agent.PlanCompleted:
					symbol, color = "checkmark.circle.fill", t.Success
				case agent.PlanInProgress:
					symbol, color = "circle.dotted", t.Accent
				}
				sfsymbols.Symbol(c, symbol).Size(13).Color(color)
				text := ui.Text(c, it.Text).TextColor(t.Text)
				if it.Status == agent.PlanCompleted {
					text.TextColor(t.TextMuted)
				}
			})
		}
	})
}
