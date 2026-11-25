package shell

import (
	"path"

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
}

func (s *Shell) workspacePanel(id string) *workspacePanel {
	if s.detail.workspaces == nil {
		s.detail.workspaces = make(map[string]*workspacePanel)
	}
	p := s.detail.workspaces[id]
	if p == nil {
		p = &workspacePanel{expanded: make(map[string]bool)}
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
		ui.Text(c, locales.WorkspaceLoading()).TextColor(c.Theme().TextMuted)
	} else if r.Err != nil {
		ui.Text(c, s.say(r.Err)).TextColor(c.Theme().Warning).Selectable()
	} else {
		return true
	}
	return false
}

func (s *Shell) filePage(c *ui.Context, id string) {
	p := s.workspacePanel(id)
	if p.file == "" {
		ui.Tree(c, func() { s.directoryRows(c, id, ".", p) })
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
	editor.View(c, p.editor).Height(360).Radius(8)
}

func (s *Shell) directoryRows(c *ui.Context, id, dir string, p *workspacePanel) {
	r := s.wb.Directory(id, dir)
	if !readReady(s, c, r) {
		return
	}
	if len(r.Value.Entries) == 0 {
		ui.Text(c, locales.DirectoryEmpty()).TextColor(c.Theme().TextMuted)
	}
	for _, entry := range r.Value.Entries {
		rel := path.Join(dir, entry.Name)
		c.Key(rel)
		if entry.Directory {
			open := p.expanded[rel]
			row := ui.TreeItem(c, entry.Name, &open, func() { s.directoryRows(c, id, rel, p) })
			if row.Clicked() {
				open = !open
			}
			p.expanded[rel] = open
		} else if ui.TreeItem(c, entry.Name, nil, nil).Clicked() {
			p.file = rel
		}
	}
	if r.Value.Truncated {
		ui.Text(c, locales.DirectoryLimited()).TextColor(c.Theme().TextMuted)
	}
}
