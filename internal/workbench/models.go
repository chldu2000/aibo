package workbench

import (
	"context"

	"github.com/chldu2000/aibo/internal/agent"
)

// SetModel changes a session's model and reasoning effort, empty for the
// Agent's own, from its next turn on: only while no turn runs, which
// ErrTurnRunning says. A running native session changes at once, and then
// reports what it uses (Status.Model, Status.Effort); else the session
// starts on them.
func (w *Workbench) SetModel(sessionID, model, effort string) error {
	w.mu.Lock()
	s, ok := w.sessions[sessionID]
	if !ok {
		w.mu.Unlock()
		return ErrNoSuchSession
	}
	if s.running {
		w.mu.Unlock()
		return ErrTurnRunning
	}
	if err := w.st.SetModel(sessionID, model, effort); err != nil {
		w.mu.Unlock()
		return err
	}
	s.info.Model, s.info.Effort = model, effort
	native := s.native
	w.log.Info("model set", "session", sessionID, "model", model, "effort", effort, "connected", native != nil)
	if native == nil {
		// What it last said no longer holds; it says again as it starts.
		s.reported = agent.SettingsReported{}
	}
	w.mu.Unlock()
	if native != nil {
		if err := native.SetModel(context.Background(), model, effort); err != nil {
			return err
		}
	}
	w.notify(Change{SessionID: sessionID})
	return nil
}

// ModelSource identifies the installation and sign-in used for a list.
type ModelSource struct {
	Path, Version, Auth string
	SignedOut           bool
}

// ModelList is a read-only snapshot shared by windows of the workbench.
type ModelList struct {
	Models  []agent.Model
	Loading bool
	Err     error
}

type modelListEntry struct {
	source ModelSource
	cancel context.CancelFunc
	list   ModelList
}

type ModelDemand int

const (
	// PeekModels reads only what is already cached.
	PeekModels ModelDemand = iota
	LoadModels
	// RetryModels also retries a failed request when the user opens the menu.
	RetryModels
)

// ModelList starts at most one lookup for a source and notifies all windows
// when it completes. An empty successful list is cached too.
func (w *Workbench) ModelList(kind agent.Kind, source ModelSource, demand ModelDemand) ModelList {
	w.mu.Lock()
	defer w.mu.Unlock()
	entry := w.modelLists[kind]
	if entry != nil && entry.source != source {
		entry.cancel()
		delete(w.modelLists, kind)
		entry = nil
	}
	if entry != nil && (entry.list.Err == nil || demand != RetryModels) {
		return entry.list
	}
	if w.closing || demand == PeekModels {
		return ModelList{}
	}
	if w.modelLists == nil {
		w.modelLists = make(map[agent.Kind]*modelListEntry)
	}
	ctx, cancel := context.WithCancel(context.Background())
	entry = &modelListEntry{source: source, cancel: cancel, list: ModelList{Loading: true}}
	w.modelLists[kind] = entry
	w.pumps.Add(1)
	go func() {
		defer w.pumps.Done()
		defer cancel()
		list, err := w.Models(ctx, kind)
		w.mu.Lock()
		current := !w.closing && w.modelLists[kind] == entry
		if current {
			entry.list = ModelList{Models: list, Err: err}
		}
		w.mu.Unlock()
		if current {
			w.notify(Change{})
		}
	}()
	return entry.list
}

// watchLists has the workbench read an Agent's models and permission
// modes again when the Agent says they changed (agent.ListsChanger), as
// an ACP Agent learning them from its sessions.
func (w *Workbench) watchLists(a agent.Agent) {
	l, ok := a.(agent.ListsChanger)
	if !ok {
		return
	}
	kind := a.Kind()
	l.OnListsChanged(func() {
		if w.agent(kind) != a {
			return // replaced since
		}
		w.mu.Lock()
		if w.closing {
			w.mu.Unlock()
			return
		}
		w.forgetLists(kind)
		w.mu.Unlock()
		w.notify(Change{})
	})
}

// forgetLists drops what was read of an Agent's lists; w.mu is held.
func (w *Workbench) forgetLists(kind agent.Kind) {
	if entry := w.modelLists[kind]; entry != nil {
		entry.cancel()
		delete(w.modelLists, kind)
	}
	if w.listVersions == nil {
		w.listVersions = make(map[agent.Kind]int)
	}
	w.listVersions[kind]++
}

// ListsVersion changes whenever an Agent's models or permission modes may
// have: when it is configured again, or says they changed. A window that
// keeps them reads them again.
func (w *Workbench) ListsVersion(kind agent.Kind) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.listVersions[kind]
}
