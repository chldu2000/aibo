package shell

import (
	"fmt"
	"slices"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// messageActions float over the corner of the message under the pointer:
// its number, when no column shows it, and what can be done with it, each
// labelled with the number, as several messages have the same.
func (s *Shell) messageActions(c *ui.Context, x model.Session, v *sessionView, m model.Message, number bool) {
	t := c.Theme()
	seq := fmt.Sprint(m.Seq)
	ui.Row(c).Key("actions").Absolute().Top(2).Right(2).Gap(2).Padding(2, 4).Radius(8).AlignItems(ui.Center).
		Background(t.Surface).Border(1, t.Border).Children(func() {
		if number {
			ui.Text(c, "#"+seq).FontSize(11).TextColor(t.TextMuted).MaxLines(1).Padding(0, 4)
		}
		if text := copyable(m); text != "" && iconButton(c, "doc.on.doc", locales.CopyMessage(seq)).Clicked() {
			c.WriteClipboard(text)
		}
		// Only what has ended can be referenced.
		if m.State.Ended() && iconButton(c, "text.quote", locales.QuoteMessage(seq)).Clicked() {
			if _, err := s.wb.ReferenceRange(x.ID, m.Seq, m.Seq, x.ID); err != nil {
				s.notice = s.failed(locales.ReferenceFailed, err)
			}
		}
		if m.Kind == model.UserMessage && iconButton(c, "arrow.uturn.backward", locales.PutBackMessage(seq)).Clicked() {
			putBack(v, m)
		}
	})
}

// copyable is what copying a message gives: the Agent's Markdown, the
// user's words (after the command they invoked), a call's output.
func copyable(m model.Message) string {
	switch {
	case m.Kind == model.ToolCall:
		if m.Tool == nil {
			return ""
		}
		return m.Tool.Output
	case m.Command != nil:
		return strings.TrimSpace("/" + m.Command.Name + " " + m.Text)
	}
	return m.Text
}

// putBack puts a sent message's words, mentions, images and command in
// the draft, after what it holds; the message stays sent.
func putBack(v *sessionView, m model.Message) {
	switch {
	case strings.TrimSpace(v.draft) == "":
		v.draft = m.Text
	case m.Text != "":
		v.draft = strings.TrimRight(v.draft, "\n") + "\n" + m.Text
	}
	for _, f := range m.Mentions {
		if !slices.ContainsFunc(v.mentions, func(g model.Mention) bool { return g.Path == f.Path }) {
			v.mentions = append(v.mentions, f)
		}
	}
	for _, a := range m.Attachments {
		if !slices.ContainsFunc(v.attachments, func(b model.Attachment) bool { return b.File == a.File }) {
			v.attachments = append(v.attachments, a)
		}
	}
	if m.Command != nil && v.command == nil {
		v.command = &agent.Command{Name: m.Command.Name, Description: m.Command.Description}
	}
	v.caretEnd = true
}
