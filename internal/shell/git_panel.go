package shell

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
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
	if len(status.Changes) == 0 {
		ui.Text(c, locales.GitClean())
		return
	}
	p := s.workspacePanel(id)
	for group, label := range []string{locales.GitStaged(), locales.GitUnstaged(), locales.GitUntracked(), locales.GitConflict()} {
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
	if p.change != nil {
		ui.Text(c, changeLabel(*p.change)).Selectable()
	}
}
