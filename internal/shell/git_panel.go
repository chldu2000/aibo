package shell

import (
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
)

func gitPathLabel(name string) string {
	if strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return strconv.Quote(name)
	}
	return name
}

func changeLabel(ch workbench.GitChange) string {
	name := gitPathLabel(ch.Path)
	if ch.Original != "" {
		name = gitPathLabel(ch.Original) + " → " + name
	}
	return ch.Code + "  " + name
}

func (s *Shell) gitPage(c *ui.Context, id string) {
	r := s.wb.GitStatus(id)
	if !readReady(s, c, r) {
		return
	}
	status := r.Value
	branch := status.Branch
	switch {
	case status.OID == "(initial)":
		branch += " · " + locales.GitUnborn()
	case branch == "(detached)":
		branch = locales.GitDetached() + " " + status.OID[:min(12, len(status.OID))]
	}
	ui.Text(c, branch).Bold().Selectable()
	p := s.workspacePanel(id)
	groups := []string{locales.GitStaged(), locales.GitUnstaged(), locales.GitUntracked(), locales.GitConflict()}
	if p.change != nil {
		ch := *p.change
		ui.Text(c, groups[ch.Group]+" · "+changeLabel(ch)).Bold().Selectable()
		if !slices.Contains(status.Changes, ch) {
			ui.Text(c, locales.GitGone())
			return
		}
		s.changeDiff(c, id, ch, p)
		return
	}
	if len(status.Changes) == 0 {
		ui.Text(c, locales.GitClean())
		return
	}
	for group, label := range groups {
		heading := false
		for _, ch := range status.Changes {
			if ch.Group != workbench.GitGroup(group) {
				continue
			}
			if !heading {
				ui.Text(c, label).Bold()
				heading = true
			}
			c.Key(label + "/" + ch.Path)
			if ui.Button(c, changeLabel(ch)).Clicked() {
				p.change = &ch
			}
		}
	}
}

func (s *Shell) changeDiff(c *ui.Context, id string, ch workbench.GitChange, p *workspacePanel) {
	if ch.Group == workbench.GitConflict {
		ui.Text(c, locales.GitUnmerged())
		return
	}
	r := s.wb.Diff(id, ch)
	if !readReady(s, c, r) {
		return
	}
	d := r.Value
	if d.Missing {
		ui.Text(c, locales.GitGone())
		return
	}
	if d.Truncated {
		ui.Text(c, locales.FilePreviewLimited())
	}
	if p.diffView == nil || p.diffFor != ch || p.diffValue != d {
		view := &editor.DiffState{Layout: editor.DiffUnified}
		if d.Untracked {
			if d.AddedText == "" {
				ui.Text(c, locales.GitEmptyAdded())
				return
			}
			view.New = editor.NewBuffer(d.AddedText)
		} else {
			files, err := editor.ParsePatch(d.Patch)
			if err != nil || len(files) != 1 {
				ui.Text(c, locales.GitMetadata())
				ui.Text(c, d.Patch).Selectable()
				return
			}
			file := files[0]
			if file.Binary {
				ui.Text(c, locales.FilePreviewBinary())
				return
			}
			if len(file.Hunks) == 0 {
				ui.Text(c, locales.GitMetadata())
				if file.OldMode != file.NewMode {
					ui.Text(c, file.OldMode+" → "+file.NewMode).Selectable()
				}
				return
			}
			view.SetPatch(file)
		}
		p.diffView, p.diffFor, p.diffValue = view, ch, d
	}
	editor.DiffView(c, p.diffView).Height(360).Radius(8)
}
