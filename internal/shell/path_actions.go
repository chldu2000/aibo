package shell

import (
	"path/filepath"
	"runtime"
	"strings"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/ui"
)

// shownPath is the file the details show of the session's workspace, by
// its path there, and whether it is gone: its folder missing, the file
// deleted. "" when they show none.
func (s *Shell) shownPath(x model.Session) (rel string, gone bool) {
	ws := s.workspaceOf(x)
	p := s.workspacePanel(x.WorkspaceID)
	switch {
	case s.detail.page == "files" && p.file != "":
		r := s.wb.FilePreview(x.WorkspaceID, p.file)
		return p.file, ws.Missing || !r.Pending && r.Err != nil
	case s.detail.page == "git" && p.change != nil:
		return p.change.Path, ws.Missing || strings.Contains(p.change.Code, "D")
	}
	return "", false
}

// pathActions are what can be done with the file the details show: copy
// its path, show it in the file manager, open it, mention it in the
// draft. Of a file gone, only its path can be copied.
func (s *Shell) pathActions(c *ui.Context, x model.Session, rel string, gone bool) {
	ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
		s.copyButton(c, locales.CopyPath(), rel)
		abs := s.absPath(x, rel)
		if s.opts.ShowInFinder != nil && iconButton(c, "folder", showInLabel()).Disabled(gone).Clicked() && !gone {
			s.opts.ShowInFinder(abs)
		}
		if s.opts.OpenFile != nil && iconButton(c, "arrow.up.forward.app", locales.OpenWithDefault()).Disabled(gone).Clicked() && !gone {
			s.opts.OpenFile(abs)
		}
		if iconButton(c, "at", locales.MentionInDraft()).Disabled(gone).Clicked() && !gone {
			s.mentionFile(x, rel, false)
		}
	})
}

// pathMenu is pathActions as a file tree row's menu.
func (s *Shell) pathMenu(c *ui.Context, m *ui.Menu, x model.Session, rel string, dir bool) {
	gone := s.workspaceOf(x).Missing
	if m.Item(locales.CopyPath()).Chosen() {
		c.WriteClipboard(rel)
	}
	abs := s.absPath(x, rel)
	if s.opts.ShowInFinder != nil && m.Item(showInLabel()).Disabled(gone).Chosen() {
		s.opts.ShowInFinder(abs)
	}
	if s.opts.OpenFile != nil && m.Item(locales.OpenWithDefault()).Disabled(gone).Chosen() {
		s.opts.OpenFile(abs)
	}
	if m.Item(locales.MentionInDraft()).Disabled(gone).Chosen() {
		s.mentionFile(x, rel, dir)
	}
}

// absPath is a path of the session's workspace, absolute.
func (s *Shell) absPath(x model.Session, rel string) string {
	return filepath.Join(s.workspaceOf(x).Path, filepath.FromSlash(rel))
}

// mentionFile mentions a file of the session's workspace in its draft.
func (s *Shell) mentionFile(x model.Session, rel string, dir bool) {
	s.mention(x, model.Mention{Path: s.absPath(x, rel), WorkspaceID: x.WorkspaceID, Dir: dir})
	s.focusComposer = x.ID
}

// showInLabel is "Show in Finder", as the platform's file manager is
// called.
func showInLabel() string {
	if runtime.GOOS == "darwin" {
		return locales.ShowInFinder()
	}
	return locales.ShowInExplorer()
}
