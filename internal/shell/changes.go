package shell

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"
)

// fitLines is how long a patch fits its lines, scrolling in a box past
// outputHeight; a longer one scrolls in a viewer outputHeight tall, not to
// lay out all its lines.
const fitLines = 400

// changesStats counts the lines the changes add and delete.
func changesStats(chs []agent.FileChange) (added, deleted int) {
	for _, ch := range chs {
		a, d := agent.PatchStats(ch.Patch)
		added, deleted = added+a, deleted+d
	}
	return added, deleted
}

// changesLabel is a call that changes files, as its line says it: the
// file's name, or how many files, and the lines added and deleted.
func changesLabel(chs []agent.FileChange) string {
	added, deleted := changesStats(chs)
	what := locales.FilesChanged(len(chs))
	if len(chs) == 1 {
		what = baseName(chs[0].Path)
		if chs[0].Kind == agent.FileMoved {
			what += " → " + baseName(chs[0].MovedTo)
		}
	}
	return fmt.Sprintf("%s +%d −%d", what, added, deleted)
}

// baseName is a path's last element, of a Windows path too.
func baseName(p string) string {
	return filepath.Base(filepath.FromSlash(strings.ReplaceAll(p, `\`, "/")))
}

// workspaceRel is a changed file's path in the session's workspace, with
// slashes, or ok false for a file outside it.
func (s *Shell) workspaceRel(x model.Session, p string) (string, bool) {
	abs := p
	if !filepath.IsAbs(abs) {
		abs = s.absPath(x, p)
	}
	rel, err := filepath.Rel(s.workspaceOf(x).Path, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filepath.ToSlash(rel), true
}

// openChanged opens a file of the session's workspace on the details'
// files page.
func (s *Shell) openChanged(x model.Session, rel string) {
	s.detail.open = true
	s.showPage("files")
	s.workspacePanel(x.WorkspaceID).file = rel
}

// fileChanges shows the files a call changed, each under its path, which
// opens it on the files page, as a diff.
func (s *Shell) fileChanges(c *ui.Context, v *sessionView, key string, chs []agent.FileChange) {
	t := c.Theme()
	x, _ := s.wb.Session(s.current)
	for i, ch := range chs {
		k := fmt.Sprintf("%s/change/%d", key, i)
		ui.Column(c).Key(k).Gap(4).Children(func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				shown, at := ch.Path, ch.Path
				if ch.Kind == agent.FileMoved {
					at = ch.MovedTo
				}
				rel, inside := s.workspaceRel(x, at)
				if r, ok := s.workspaceRel(x, ch.Path); ok {
					shown = r
				}
				text := func(ink ui.Color) {
					ui.Text(c, shown).Font("Menlo").FontSize(11).TextColor(ink).MaxLines(1).TruncateMiddle().MinWidth(0)
				}
				// A file deleted, or out of the workspace, does not open.
				if inside && ch.Kind != agent.FileDeleted {
					open := locales.OpenChangedFile(rel)
					link := ui.Box(c).Radius(4).Padding(1, 3).MinWidth(0).Shrink(1).Label(open).Tooltip(open).Children(func() { text(t.Accent) })
					if link.Hovered() {
						link.Background(t.SurfaceHover)
					}
					if link.Clicked() {
						s.openChanged(x, rel)
					}
				} else {
					ui.Box(c).Padding(1, 3).MinWidth(0).Shrink(1).Children(func() { text(t.Text) })
				}
				switch ch.Kind {
				case agent.FileAdded:
					tag(c, locales.FileAdded(), t.Success)
				case agent.FileDeleted:
					tag(c, locales.FileDeleted(), t.Danger)
				case agent.FileMoved:
					tag(c, locales.FileMovedTo(ch.MovedTo), t.TextMuted)
				}
				added, deleted := agent.PatchStats(ch.Patch)
				ui.Text(c, fmt.Sprintf("+%d", added)).FontSize(11).TextColor(t.Success).NoWrap()
				ui.Text(c, fmt.Sprintf("−%d", deleted)).FontSize(11).TextColor(t.Danger).NoWrap()
			})
			s.patchView(c, v, k, ch.Patch)
		})
	}
}

// tag is a word in a small frame of ink.
func tag(c *ui.Context, text string, ink ui.Color) {
	ui.Text(c, text).FontSize(10).TextColor(ink).NoWrap().Padding(0, 5).Radius(5).BorderWidth(1).BorderColor(ink)
}

// patchView shows a file's patch as a diff, no taller than outputHeight;
// one that does not read as a patch, as text.
func (s *Shell) patchView(c *ui.Context, v *sessionView, key, patch string) {
	t := c.Theme()
	if patch == "" {
		ui.Text(c, locales.ChangeNoPatch()).FontSize(11).TextColor(t.TextMuted)
		return
	}
	d, ok := v.open.diffs[key]
	if !ok || d.patch != patch {
		d = patchDiff{patch: patch}
		if files, err := editor.ParsePatch(patch); err == nil && len(files) == 1 && len(files[0].Hunks) > 0 {
			d.st = &editor.DiffState{Layout: editor.DiffUnified, NoBackground: true}
			d.st.SetPatch(files[0])
			d.lines = strings.Count(patch, "\n")
			d.st.FitContent = d.lines <= fitLines
		}
		v.open.diffs[key] = d
	}
	if d.st == nil {
		readOutput(c, &v.open, key, patch, outputHeight)
		return
	}
	if d.st.FitContent {
		ui.Scroll(c).MaxHeight(outputHeight).MinWidth(0).Radius(8).Background(t.Surface).Children(func() {
			editor.DiffView(c, d.st)
		})
		return
	}
	editor.DiffView(c, d.st).Height(outputHeight).Radius(8)
}

// patchDiff is a patch's diff viewer, and the patch it was made of.
type patchDiff struct {
	patch string
	st    *editor.DiffState
	lines int
}
