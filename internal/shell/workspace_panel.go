package shell

import (
	"path"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
)

type workspacePanel struct {
	diffView                 *editor.DiffState
	diffFor                  workbench.GitChange
	diffValue                workbench.ChangeDiff
	change                   *workbench.GitChange
	expanded                 map[string]bool
	file                     string
	editor                   *editor.State
	previewPath, previewText string
	// folded and all are the Git page's groups folded and shown whole,
	// by their names.
	folded, all map[string]bool
}

func (s *Shell) workspacePanel(id string) *workspacePanel {
	if s.detail.workspaces == nil {
		s.detail.workspaces = make(map[string]*workspacePanel)
	}
	p := s.detail.workspaces[id]
	if p == nil {
		p = &workspacePanel{expanded: map[string]bool{}, folded: map[string]bool{}, all: map[string]bool{}}
		s.detail.workspaces[id] = p
	}
	return p
}

func (s *Shell) watchPanel(id string) {
	if s.detail.watched == id {
		return
	}
	if s.detail.release != nil {
		s.detail.release()
		s.detail.release = nil
	}
	s.detail.watched = id
	if id != "" {
		s.detail.release = s.wb.ObserveWorkspace(id)
	}
}

// RefreshVisibleWorkspace runs on the window thread when it regains focus.
func (s *Shell) RefreshVisibleWorkspace() {
	if id := s.detail.watched; id != "" {
		s.wb.RefreshWorkspace(id)
	}
}

func readReady[T any](s *Shell, c *ui.Context, r workbench.Snapshot[T]) bool {
	if r.Pending {
		emptyState(c, "circle.dotted", locales.WorkspaceLoading())
	} else if r.Err != nil {
		ui.Column(c).Gap(8).Padding(40, 16).AlignItems(ui.Center).Children(func() {
			icon(c, "exclamationmark.circle").Size(24).Color(c.Theme().Warning)
			ui.Text(c, s.say(r.Err)).FontSize(12).TextColor(c.Theme().Text).TextAlign(ui.Center).Selectable()
		})
	} else {
		return true
	}
	return false
}

func (s *Shell) filePage(c *ui.Context, x model.Session) {
	id := x.WorkspaceID
	p := s.workspacePanel(id)
	if p.file == "" {
		ui.Tree(c, func() { s.directoryRows(c, x, ".", p) })
		return
	}
	r := s.wb.FilePreview(id, p.file)
	if !readReady(s, c, r) {
		return
	}
	if r.Value.Truncated {
		ui.Text(c, locales.FilePreviewLimited()).TextColor(c.Theme().TextMuted)
	}
	if p.editor == nil || p.previewPath != p.file || p.previewText != r.Value.Text {
		buf := editor.NewBuffer(r.Value.Text)
		buf.SetLanguage(editor.LanguageFor(p.file))
		p.editor = &editor.State{Buffer: buf, ReadOnly: true}
		p.previewPath, p.previewText = p.file, r.Value.Text
	}
	editor.View(c, p.editor).Grow(1).MinHeight(120).Radius(8)
}

func (s *Shell) directoryRows(c *ui.Context, x model.Session, dir string, p *workspacePanel) {
	id := x.WorkspaceID
	r := s.wb.Directory(id, dir)
	if !readReady(s, c, r) {
		return
	}
	if len(r.Value.Entries) == 0 {
		if dir == "." {
			emptyState(c, "folder", locales.DirectoryEmpty())
		} else {
			ui.Text(c, locales.DirectoryEmpty()).FontSize(12).TextColor(c.Theme().TextMuted)
		}
	}
	for _, entry := range r.Value.Entries {
		rel := path.Join(dir, entry.Name)
		c.Key(rel)
		if entry.Directory {
			open := p.expanded[rel]
			row := ui.TreeItem(c, entry.Name, &open, func() { s.directoryRows(c, x, rel, p) })
			row.ContextMenu(func(m *ui.Menu) { s.pathMenu(c, m, x, rel, true) })
			if row.Clicked() {
				open = !open
			}
			p.expanded[rel] = open
		} else {
			row := ui.TreeItem(c, entry.Name, nil, nil)
			row.ContextMenu(func(m *ui.Menu) { s.pathMenu(c, m, x, rel, false) })
			if row.Clicked() {
				p.file = rel
			}
		}
	}
	if r.Value.Truncated {
		ui.Text(c, locales.DirectoryLimited()).TextColor(c.Theme().TextMuted)
	}
}
