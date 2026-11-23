package shell

import (
	"github.com/chldu2000/aibo/locales"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// pull is the @ panel of a receiving session: the user finds a source
// session, chooses a range of it, sees the brief as it would be, and
// inserts the reference in the composer.
type pull struct {
	open  bool
	query string
	// at is where the "@" that opened the panel is in the draft of
	// session in, replaced by the reference chosen; -1 when the @ button
	// opened it.
	at int
	in string
	// files are the files matching the search.
	files fileSearch
	// source is the session chosen, with its own view for choosing
	// messages; nil while searching.
	source *model.Session
	v      *sessionView
	// brief caches the preview of the range from..to.
	brief              string
	briefErr           string
	briefFrom, briefTo int
}

// typedAt reports whether the edit from before to after typed an "@" that
// opens the @ panel, and where it is in after: the text inserted (typed,
// or committed by an input method) ends with "@", at the start of a line
// or after a space. An "@" after anything else, as in a@b, is text.
func typedAt(before, after string) (int, bool) {
	if len(after) <= len(before) {
		return -1, false
	}
	p := 0
	for p < len(before) && before[p] == after[p] {
		p++
	}
	q := 0
	for q < len(before)-p && before[len(before)-1-q] == after[len(after)-1-q] {
		q++
	}
	if !strings.HasSuffix(after[p:len(after)-q], "@") {
		return -1, false
	}
	at := len(after) - q - 1
	if r, _ := utf8.DecodeLastRuneInString(after[:at]); at > 0 && !unicode.IsSpace(r) {
		return -1, false
	}
	return at, true
}

// dropAt is draft without the "@" at byte at, when it is still there.
func dropAt(draft string, at int) string {
	if at < 0 || at >= len(draft) || draft[at] != '@' {
		return draft
	}
	return draft[:at] + draft[at+1:]
}

// openPull opens the @ panel: by the "@" at byte at of session id's
// draft, or by the @ button when at is -1.
func (s *Shell) openPull(id string, at int) {
	s.pull = pull{open: true, at: at, in: id}
}

// pullPanel shows the @ panel, when open, for the receiving session x.
func (s *Shell) pullPanel(c *ui.Context, x model.Session) {
	if !s.pull.open {
		return
	}
	ui.Modal(c, &s.pull.open, func() {
		ui.Column(c).Width(760).Height(560).Gap(10).Padding(16).Children(func() {
			if s.pull.source == nil {
				s.pullSearch(c, x)
			} else {
				s.pullRange(c, x)
			}
		})
	})
	// However it closed, the caret goes back to the composer.
	if !s.pull.open {
		s.refocus = true
	}
}

// pullSearch finds the files to mention by their paths, and the source
// session by its title.
func (s *Shell) pullSearch(c *ui.Context, x model.Session) {
	t := c.Theme()
	ui.Text(c, locales.MentionPanel()).Bold().FontSize(15).TextColor(t.Text)
	ui.TextInput(c, &s.pull.query).Placeholder(locales.MentionSearch()).Label(locales.MentionSearchLabel()).AutoFocus()
	s.matchFiles(x.ID, strings.TrimSpace(s.pull.query))
	q := strings.ToLower(strings.TrimSpace(s.pull.query))
	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).Gap(2).Children(func() {
			s.pullFiles(c, x)
			ui.Text(c, locales.SessionsHeading()).FontSize(11).Bold().TextColor(t.TextMuted).Padding(10, 8, 2)
			found := false
			// Every session, archived ones and those of removed
			// workspaces too, the most recent first.
			for _, src := range s.wb.Sessions() {
				if src.ID == x.ID || !strings.Contains(strings.ToLower(sessionTitle(src)), q) {
					continue
				}
				found = true
				ws := s.workspaceOf(src)
				row := pickRow(c, src.ID, locales.ChooseSession(sessionTitle(src)), func() {
					s.agentGlyph(c, src.Agent, 16)
					ui.Text(c, sessionTitle(src)).TextColor(t.Text).MaxLines(1).Grow(1)
					if src.Archived {
						ui.Text(c, locales.Archived()).FontSize(11).TextColor(t.TextMuted)
					}
					ui.Text(c, workspaceName(ws)).FontSize(11).TextColor(t.TextMuted)
				})
				if row.Clicked() {
					s.choosePullSource(src)
				}
			}
			if !found {
				ui.Text(c, locales.NoSessionsFound()).TextColor(t.TextMuted).Padding(8)
			}
		})
	})
}

func (s *Shell) choosePullSource(src model.Session) {
	msgs, err := s.wb.Messages(src.ID)
	if err != nil {
		s.notice = s.say(err)

		return
	}
	v := &sessionView{msgs: msgs, loaded: true}
	v.list.Key = func(i int) any { return v.msgs[i].Seq }
	v.sel = selection{on: true}
	v.list.Selection = &v.sel.chosen
	v.list.DragSelect = true
	s.pull.source, s.pull.v = &src, v
	s.pull.briefFrom, s.pull.briefTo = -1, -1
}

// pullRange chooses the range on the source's timeline, with the brief
// as it would be beside it.
func (s *Shell) pullRange(c *ui.Context, x model.Session) {
	t := c.Theme()
	p := &s.pull
	v, src := p.v, *p.source
	v.normalize()
	n := v.sel.chosen.Len()
	back := false
	ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
		back = iconButton(c, "chevron.left", locales.BackToSearch()).Clicked()
		s.agentGlyph(c, src.Agent, 18)
		ui.Text(c, sessionTitle(src)).Bold().TextColor(t.Text).NoWrap().Grow(1)
	})
	if back {
		p.source, p.v = nil, nil
		return
	}
	ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
		if n == 0 {
			ui.Text(c, locales.PullHint()).FontSize(12).TextColor(t.TextMuted)
		} else {
			ui.Text(c, locales.Selected(refs.Range(v.sel.from, v.sel.to), n)).FontSize(12).Bold().TextColor(t.Text)
			if v.sel.filled {
				ui.Text(c, locales.FilledGaps()).FontSize(12).TextColor(t.Warning)
			}
		}
		ui.Spacer(c)
		if ui.Button(c, locales.SelectAll()).Clicked() && len(v.msgs) > 0 {
			v.choose(v.msgs[0].Seq, v.msgs[len(v.msgs)-1].Seq)
		}
		if ui.Button(c, locales.SelectTurns()).Disabled(n == 0).Clicked() && n > 0 {
			v.wholeTurns()
		}
	})
	ui.Row(c).Grow(1).Gap(12).AlignItems(ui.Stretch).Children(func() {
		th := *t
		th.Accent, th.AccentText = tinted(c, ui.RGBA(40, 120, 255, 0.28)), t.Text
		ui.Themed(c, &th).Width(360).Children(func() {
			ui.List(c, &v.list, len(v.msgs), func(i int) {
				m := v.msgs[i]
				ui.Row(c).Gap(8).Padding(6, 8).IgnoreInput(true).Children(func() {
					ui.Textf(c, "#%d", m.Seq).FontSize(11).TextColor(t.TextMuted).Width(44).MaxLines(1)
					ui.Column(c).Grow(1).Gap(2).Children(func() {
						ui.Text(c, s.roleOf(*p.source, m)).FontSize(11).TextColor(t.TextMuted)
						ui.Text(c, oneLine(m.Text, 80)).FontSize(12).TextColor(t.Text).NoWrap()
					})
				})
			}).Fill().Radius(10).Background(t.Surface)
		})
		ui.Column(c).Grow(1).Gap(6).Children(func() {
			ui.Text(c, locales.BriefHeading()).FontSize(12).TextColor(t.TextMuted)
			ui.Scroll(c).Grow(1).Radius(10).Background(t.Surface).Children(func() {
				text := locales.BriefPending()
				if n > 0 {
					text = s.pullBrief(x)
				}
				ui.Text(c, text).Font("Menlo").FontSize(11).TextColor(t.Text).Selectable().Padding(10)
			})
		})
	})
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c)
		if ui.Button(c, locales.Cancel()).Clicked() {
			p.open = false
		}
		if ui.PrimaryButton(c, locales.InsertReference()).Disabled(n == 0 || p.briefErr != "").Clicked() && n > 0 {
			if _, err := s.wb.ReferenceRange(p.source.ID, v.sel.from, v.sel.to, x.ID); err != nil {
				p.briefErr = s.say(err)
				return
			}
			// The chip takes the place of the "@" typed.
			if v := s.views[p.in]; v != nil && p.in == x.ID {
				v.draft = dropAt(v.draft, p.at)
				v.typed = v.draft
			}
			s.pull = pull{}
		}
	})
}

// pullBrief is the brief of the chosen range for x, made again only when
// the range changes.
func (s *Shell) pullBrief(x model.Session) string {
	p := &s.pull
	from, to := p.v.sel.from, p.v.sel.to
	if from != p.briefFrom || to != p.briefTo {
		p.briefFrom, p.briefTo = from, to
		p.brief, p.briefErr = "", ""
		b, err := s.wb.PreviewBrief(p.source.ID, from, to, workbench.Target{SessionID: x.ID, Agent: x.Agent, WorkspaceID: x.WorkspaceID})
		if err != nil {
			p.briefErr = s.say(err)
		}
		p.brief = b
	}
	if p.briefErr != "" {
		return withDetail(locales.CannotReferenceRange(), p.briefErr)
	}
	return p.brief
}

func (s *Shell) roleOf(x model.Session, m model.Message) string {
	if m.Kind == model.UserMessage {
		return locales.RoleUser()
	}
	return s.agentName(x.Agent)
}

// oneLine is text on one line, cut to n characters.
func oneLine(text string, n int) string {
	text = strings.Join(strings.Fields(text), " ")
	if r := []rune(text); len(r) > n {
		return string(r[:n]) + "…"
	}
	return text
}
