package shell

import (
	"path"
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

// changeLabel names a change for assistive technology and the tests: its
// code and its path, as git status --short does.
func changeLabel(ch workbench.GitChange) string {
	return ch.Code + "  " + changeName(ch)
}

// changeName is a change's path, from its old one where it was renamed.
func changeName(ch workbench.GitChange) string {
	name := gitPathLabel(ch.Path)
	if ch.Original != "" {
		name = gitPathLabel(ch.Original) + " → " + name
	}
	return name
}

// changeCode is a change's status letter, colored as editors color it:
// modified in the warning's color, added in the success's, removed and
// conflicting in the danger's.
func changeCode(c *ui.Context, ch workbench.GitChange) {
	t := c.Theme()
	ink := t.TextMuted
	switch {
	case ch.Group == workbench.GitConflict || ch.Code == "D":
		ink = t.Danger
	case ch.Code == "M" || ch.Code == "T":
		ink = t.Warning
	case ch.Code == "A" || ch.Code == "?" || ch.Code == "C":
		ink = t.Success
	case ch.Code == "R":
		ink = t.Accent
	}
	ui.Text(c, ch.Code).Font("Menlo").Bold().FontSize(12).TextColor(ink).Width(14).TextAlign(ui.Center)
}

func gitGroups() []string {
	return []string{locales.GitStaged(), locales.GitUnstaged(), locales.GitUntracked(), locales.GitConflict()}
}

func (s *Shell) gitPage(c *ui.Context, id string) {
	t := c.Theme()
	r := s.wb.GitStatus(id)
	if !readReady(s, c, r) {
		return
	}
	status := r.Value
	p := s.workspacePanel(id)
	groups := gitGroups()
	if p.change != nil {
		ch := *p.change
		ui.Column(c).Gap(8).Children(func() {
			ui.Row(c).Gap(6).Padding(0, 4).AlignItems(ui.Center).Children(func() {
				changeCode(c, ch)
				ui.Text(c, groups[ch.Group]).FontSize(12).TextColor(t.TextMuted)
			})
			if !slices.Contains(status.Changes, ch) {
				ui.Text(c, locales.GitGone()).TextColor(t.TextMuted)
				return
			}
			s.changeDiff(c, id, ch, p)
		})
		return
	}
	branch := status.Branch
	switch {
	case status.OID == "(initial)":
		branch += " · " + locales.GitUnborn()
	case branch == "(detached)":
		branch = locales.GitDetached() + " " + status.OID[:min(12, len(status.OID))]
	}
	ui.Column(c).Gap(14).Children(func() {
		ui.Row(c).Gap(6).Padding(0, 6).AlignItems(ui.Center).Children(func() {
			icon(c, "arrow.triangle.branch").Size(13).Color(t.TextMuted)
			ui.Text(c, branch).Bold().FontSize(13).TextColor(t.Text).Selectable().MaxLines(1).Shrink(1).MinWidth(0)
		})
		if len(status.Changes) == 0 {
			ui.Text(c, locales.GitClean()).FontSize(12).TextColor(t.TextMuted).Padding(0, 6)
			return
		}
		for group, label := range groups {
			var changes []workbench.GitChange
			for _, ch := range status.Changes {
				if ch.Group == workbench.GitGroup(group) {
					changes = append(changes, ch)
				}
			}
			if len(changes) == 0 {
				continue
			}
			ui.Column(c).Key(label).Gap(2).Children(func() {
				ui.Row(c).Gap(6).Padding(0, 6, 2).Children(func() {
					ui.Text(c, label).Bold().FontSize(11).TextColor(t.TextMuted)
					ui.Text(c, strconv.Itoa(len(changes))).FontSize(11).TextColor(t.TextMuted)
				})
				for _, ch := range changes {
					s.changeRow(c, label, ch, p)
				}
			})
		}
	})
}

// changeRow shows a change as a file list does: its letter, its name, and
// the folder it is in, muted.
func (s *Shell) changeRow(c *ui.Context, group string, ch workbench.GitChange, p *workspacePanel) {
	t := c.Theme()
	dir, name := path.Split(ch.Path)
	where := strings.TrimSuffix(dir, "/")
	if ch.Original != "" {
		where = "← " + gitPathLabel(ch.Original)
	}
	row := pickRow(c, group+"/"+ch.Path, changeLabel(ch), func() {
		changeCode(c, ch)
		ui.Text(c, gitPathLabel(name)).FontSize(13).TextColor(t.Text).MaxLines(1).Shrink(1).MinWidth(0)
		ui.Text(c, gitPathLabel(where)).FontSize(11).TextColor(t.TextMuted).MaxLines(1).TruncateMiddle().Basis(0).Grow(1).MinWidth(0)
	})
	if row.Clicked() {
		p.change = &ch
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
