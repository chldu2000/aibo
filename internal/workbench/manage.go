package workbench

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/model"
)

// Errors of managing workspaces and sessions.
var (
	ErrWorkspaceMissing = errors.New("the workspace's folder is missing")
	ErrPathInUse        = errors.New("the folder is another workspace")
)

// Workspace returns a workspace, also one removed.
func (w *Workbench) Workspace(id string) (model.Workspace, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.workspace(id)
}

// RemoveWorkspace removes a workspace from the list: its sessions are
// archived, their data kept. Adding its folder again brings it back.
func (w *Workbench) RemoveWorkspace(id string) error {
	w.mu.Lock()
	i := w.workspaceIndex(id)
	if i < 0 {
		w.mu.Unlock()
		return ErrNoSuchWorkspace
	}
	ws := w.workspaces[i]
	ws.Removed = true
	if err := w.st.SetWorkspace(ws); err != nil {
		w.mu.Unlock()
		return err
	}
	if err := w.st.ArchiveWorkspace(id); err != nil {
		w.mu.Unlock()
		return err
	}
	w.workspaces[i] = ws
	for _, s := range w.sessions {
		if s.info.WorkspaceID == id {
			s.info.Archived = true
		}
	}
	w.mu.Unlock()
	w.notify(Change{})
	return nil
}

func (w *Workbench) workspaceIndex(id string) int {
	for i, ws := range w.workspaces {
		if ws.ID == id {
			return i
		}
	}
	return -1
}

// Relocate points a workspace whose folder moved at where it is now. Its
// native sessions start again there, resumed, at their next message.
func (w *Workbench) Relocate(id, path string) error {
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if fi, err := os.Stat(abs); err != nil || !fi.IsDir() {
		return fmt.Errorf("%s：%w", abs, ErrNotDirectory)
	}
	w.mu.Lock()
	i := w.workspaceIndex(id)
	if i < 0 {
		w.mu.Unlock()
		return ErrNoSuchWorkspace
	}
	for _, other := range w.workspaces {
		if other.ID != id && other.Path == abs && !other.Removed {
			w.mu.Unlock()
			return fmt.Errorf("%s：%w", abs, ErrPathInUse)
		}
	}
	ws := w.workspaces[i]
	ws.Path, ws.Missing = abs, false
	if err := w.st.SetWorkspace(ws); err != nil {
		w.mu.Unlock()
		return err
	}
	w.workspaces[i] = ws
	var stop []agent.Session
	for sid, s := range w.sessions {
		if s.info.WorkspaceID == id && s.native != nil && !s.running {
			stop = append(stop, w.detach(sid, s))
		}
	}
	w.mu.Unlock()
	for _, n := range stop {
		n.Close()
	}
	w.notify(Change{})
	return nil
}

// checkWorkspaces notes which workspaces' folders are gone.
func (w *Workbench) checkWorkspaces() {
	w.mu.Lock()
	paths := make([]string, len(w.workspaces))
	for i, ws := range w.workspaces {
		paths[i] = ws.Path
	}
	w.mu.Unlock()
	missing := make([]bool, len(paths))
	for i, p := range paths {
		fi, err := os.Stat(p)
		missing[i] = err != nil || !fi.IsDir()
	}
	changed := false
	w.mu.Lock()
	for i := range w.workspaces {
		if i < len(missing) && w.workspaces[i].Path == paths[i] && w.workspaces[i].Missing != missing[i] {
			w.workspaces[i].Missing, changed = missing[i], true
		}
	}
	w.mu.Unlock()
	if changed {
		w.notify(Change{})
	}
}

// CheckWorkspaces looks again whether the workspaces' folders are there,
// as when the window comes to the front.
func (w *Workbench) CheckWorkspaces() { w.checkWorkspaces() }

// Rename sets a session's title. An empty title goes back to the start
// of its first message. References keep the title they were made with.
func (w *Workbench) Rename(id, title string) error {
	title = strings.TrimSpace(title)
	w.mu.Lock()
	s, ok := w.sessions[id]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	manual := title != ""
	if !manual {
		if err := w.load(id, s); err != nil {
			w.mu.Unlock()
			return err
		}
		for _, m := range s.msgs {
			if m.Kind == model.UserMessage && m.Text != "" {
				title = defaultTitle(m.Text)
				break
			}
		}
	}
	if err := w.st.SetTitle(id, title, manual); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.Title, s.info.TitleManual = title, manual
	w.mu.Unlock()
	w.notify(Change{SessionID: id})
	return nil
}

// SetArchived archives a session, hiding it from its workspace, or
// brings it back. Archived, it can still be read, searched and
// referenced. A session of a removed workspace comes back to its
// workspace, which comes back too.
func (w *Workbench) SetArchived(id string, archived bool) error {
	w.mu.Lock()
	s, ok := w.sessions[id]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	if err := w.st.SetArchived(id, archived); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.Archived = archived
	if i := w.workspaceIndex(s.info.WorkspaceID); !archived && i >= 0 && w.workspaces[i].Removed {
		ws := w.workspaces[i]
		ws.Removed = false
		if err := w.st.SetWorkspace(ws); err == nil {
			w.workspaces[i] = ws
		}
	}
	w.mu.Unlock()
	w.notify(Change{})
	return nil
}

// ReferencesTo counts the references other sessions have to a session,
// which deleting it would break.
func (w *Workbench) ReferencesTo(id string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	n := 0
	for _, r := range w.refs {
		if r.SourceID == id && r.TargetID != id {
			n++
		}
	}
	return n
}

// Found is a session a search found, and where: its title (Snippet
// empty), or a message.
type Found struct {
	Session model.Session
	Snippet string
}

// SearchSessions finds the sessions, archived too, whose titles or
// messages hold text, those by title first, then the most recent.
func (w *Workbench) SearchSessions(text string) ([]Found, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	w.mu.Lock()
	byText, err := w.st.SearchMessages(text)
	var out []Found
	lower := strings.ToLower(text)
	for _, s := range w.sessions {
		if strings.Contains(strings.ToLower(s.info.Title), lower) {
			out = append(out, Found{Session: s.info})
		} else if t, ok := byText[s.info.ID]; ok {
			out = append(out, Found{Session: s.info, Snippet: around(t, text)})
		}
	}
	w.mu.Unlock()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if (out[i].Snippet == "") != (out[j].Snippet == "") {
			return out[i].Snippet == ""
		}
		return out[i].Session.ActiveAt.After(out[j].Session.ActiveAt)
	})
	return out, nil
}

// around is about 60 characters of text around where q is, on one line.
func around(text, q string) string {
	text = strings.Join(strings.Fields(text), " ")
	i := strings.Index(strings.ToLower(text), strings.ToLower(q))
	r := []rune(text)
	if i < 0 {
		i = 0
	}
	at := len([]rune(text[:i]))
	from, to := max(at-20, 0), min(at+40, len(r))
	s := string(r[from:to])
	if from > 0 {
		s = "…" + s
	}
	if to < len(r) {
		s += "…"
	}
	return s
}

// ModelLister is an Agent that tells its models.
type ModelLister interface {
	Models(ctx context.Context) ([]agent.Model, error)
}

// Models returns the models an Agent offers, if it tells.
func (w *Workbench) Models(ctx context.Context, kind agent.Kind) ([]agent.Model, error) {
	a := w.agent(kind)
	if l, ok := a.(ModelLister); ok {
		return l.Models(ctx)
	}
	return nil, nil
}

// Received counts the references delivered to a session.
func (w *Workbench) Received(id string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.delivered(id))
}

// TellsModels reports whether an Agent tells its models (Models).
func (w *Workbench) TellsModels(kind agent.Kind) bool {
	_, ok := w.agent(kind).(ModelLister)
	return ok
}
