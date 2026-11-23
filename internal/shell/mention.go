package shell

import (
	"context"
	"github.com/chldu2000/aibo/locales"
	"path/filepath"
	"strings"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// fileSearch is the @ panel's files matching what the user typed, matched
// off the main thread.
type fileSearch struct {
	// query is what hits match; gen counts the searches, so that an
	// older one coming back late is dropped.
	query   string
	gen     int
	asked   bool
	hits    []workbench.FileHit
	loading bool
	err     string
}

// filesShown is how many files the @ panel lists.
const filesShown = 8

// matchFiles matches the session's files against query, unless it was
// the last one matched.
func (s *Shell) matchFiles(sessionID, query string) {
	f := &s.pull.files
	if f.asked && f.query == query {
		return
	}
	f.asked, f.query, f.loading = true, query, true
	f.gen++
	gen := f.gen
	go func() {
		hits, err := s.wb.MatchFiles(context.Background(), sessionID, query, filesShown)
		s.later(func() {
			if s.pull.files.gen != gen {
				return
			}
			s.pull.files.hits, s.pull.files.loading, s.pull.files.err = hits, false, ""
			if err != nil {
				s.pull.files.err = s.say(err)

			}
		})
	}()
}

// pullFiles lists the files matching the @ panel's search; a click
// mentions one.
func (s *Shell) pullFiles(c *ui.Context, x model.Session) {
	t := c.Theme()
	f := &s.pull.files
	ui.Text(c, locales.FilesHeading()).FontSize(11).Bold().TextColor(t.TextMuted).Padding(4, 8, 2)
	switch {
	case f.err != "":
		ui.Text(c, withDetail(locales.FilesFailed(), f.err)).FontSize(11).TextColor(t.Warning).Padding(4, 8)
	case len(f.hits) == 0 && f.loading:
		ui.Text(c, locales.FilesLoading()).FontSize(12).TextColor(t.TextMuted).Padding(4, 8)
	case len(f.hits) == 0:
		ui.Text(c, locales.NoFiles()).FontSize(12).TextColor(t.TextMuted).Padding(4, 8)
	}
	for _, h := range f.hits {
		symbol := "doc.text"
		if h.Mention.Dir {
			symbol = "folder"
		}
		row := pickRow(c, "f"+h.Mention.Path, locales.ChooseFile(h.Rel), func() {
			sfsymbols.Symbol(c, symbol).Size(14).Color(t.TextMuted)
			ui.Text(c, h.Rel).Font("Menlo").FontSize(12).TextColor(t.Text).MaxLines(1).TruncateMiddle().Grow(1).Shrink(1).MinWidth(0)
			if h.Workspace != "" {
				ui.Text(c, locales.SourceWorkspace(filepath.Base(h.Workspace))).FontSize(11).TextColor(t.TextMuted).NoWrap()
			}
		})
		if row.Clicked() {
			s.mention(x, h.Mention)
		}
	}
}

// mention adds a file to the session's draft, in place of the "@" that
// opened the panel, and closes it.
func (s *Shell) mention(x model.Session, m model.Mention) {
	v := s.view(x.ID)
	dup := false
	for _, have := range v.mentions {
		dup = dup || have.Path == m.Path
	}
	if !dup {
		v.mentions = append(v.mentions, m)
	}
	if s.pull.in == x.ID {
		v.draft = dropAt(v.draft, s.pull.at)
		v.typed = v.draft
	}
	s.pull = pull{}
}

// mentionName is how a mention reads: its path in the session's own
// workspace, or the source workspace's name before it.
func (s *Shell) mentionName(x model.Session, m model.Mention) string {
	own := s.workspaceOf(x).Path
	if rel, ok := strings.CutPrefix(m.Path, own+"/"); ok {
		return rel
	}
	if ws, ok := s.wb.Workspace(m.WorkspaceID); ok {
		if rel, ok := strings.CutPrefix(m.Path, ws.Path+"/"); ok {
			return filepath.Base(ws.Path) + "/" + rel
		}
	}
	return m.Path
}

// mentionChip shows a mentioned file, its full path on hover; remove,
// when set, takes it out of the draft.
func (s *Shell) mentionChip(c *ui.Context, x model.Session, m model.Mention, remove func()) {
	t := c.Theme()
	name := s.mentionName(x, m)
	symbol := "doc.text"
	if m.Dir {
		symbol = "folder"
	}
	ui.Row(c).Key("m"+m.Path).Gap(6).Padding(3, 4, 3, 8).Radius(8).AlignItems(ui.Center).BorderWidth(1).BorderColor(t.Border).Tooltip(m.Path).Children(func() {
		sfsymbols.Symbol(c, symbol).Size(12).Color(t.TextMuted)
		ui.Text(c, name).Font("Menlo").FontSize(12).TextColor(t.Text).MaxLines(1).TruncateMiddle().MaxWidth(320)
		if remove != nil && iconButton(c, "xmark", locales.RemoveFile(name)).Clicked() {
			remove()
		}
	})
}

// draftMentions are the chips of the files the draft mentions.
func (s *Shell) draftMentions(c *ui.Context, x model.Session, v *sessionView) {
	for i, m := range v.mentions {
		i := i
		s.mentionChip(c, x, m, func() { v.mentions = append(v.mentions[:i:i], v.mentions[i+1:]...) })
	}
}
