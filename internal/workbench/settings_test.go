package workbench_test

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/refs"
	"github.com/chldu2000/aibo/internal/store"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestSettings(t *testing.T) {
	dir := t.TempDir()
	sc := newScript()
	b := open(t, dir, sc.respond)
	if got := b.Settings(); !reflect.DeepEqual(got, workbench.DefaultSettings) {
		t.Errorf("settings = %+v", got)
	}
	s := workbench.Settings{DefaultModes: map[agent.Kind]string{fake.Kind: fake.ModeEdits}, Notify: false,
		Budgets: refs.Budgets{Page: 2000, ToolOutput: 500, MessagePage: 3000}, IdleTimeout: 10 * time.Minute}
	if err := b.SetSettings(s); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []workbench.Settings{
		{DefaultModes: map[agent.Kind]string{fake.Kind: "yolo"}, Budgets: s.Budgets, IdleTimeout: time.Hour},
		{Budgets: refs.Budgets{Page: 10, ToolOutput: 5, MessagePage: 10}, IdleTimeout: time.Hour},
		{Budgets: s.Budgets, IdleTimeout: time.Second},
	} {
		if err := b.SetSettings(bad); !errors.Is(err, workbench.ErrBadSettings) {
			t.Errorf("%+v: %v", bad, err)
		}
	}
	// New sessions take their Agent's default mode.
	ws, err := b.AddWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	x, _ := b.NewSession(ws.ID, fake.Kind, "")
	if x.Mode != fake.ModeEdits {
		t.Errorf("new session's mode = %q", x.Mode)
	}
	// The budgets apply to the reads to come.
	long := strings.Repeat("长句子", 2000)
	converse(t, b, sc, x.ID, long, long)
	tgt, _ := b.NewSession(ws.ID, fake.Kind, "")
	r, _ := b.ReferenceSession(x.ID, tgt.ID)
	converse(t, b, sc, tgt.ID, "读")
	_, opts := lastTurn(sc)
	page, _ := call(t, opts, "read_reference", map[string]any{"ref_id": r.ID})
	if n := refs.EstimateTokens(page); n > 2600 {
		t.Errorf("a page of %d tokens with a budget of 2000", n)
	}
	b.Close()

	b2 := open(t, dir, newScript().respond)
	defer b2.Close()
	if got := b2.Settings(); !reflect.DeepEqual(got, s) {
		t.Errorf("after restart: %+v", got)
	}
}

// Settings saved before ADR 0003 had one approval level for every Agent:
// it becomes each Agent's mode.
func TestSettingsLevelBecomesModes(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st.SetSetting("workbench", map[string]any{"DefaultLevel": "auto", "Notify": true,
		"Budgets": refs.DefaultBudgets, "IdleTimeout": time.Hour})
	st.Close()
	b := open(t, dir, newScript().respond)
	defer b.Close()
	got := b.Settings()
	want := map[agent.Kind]string{"claude": "bypassPermissions", "codex": "full-access"}
	if got.DefaultLevel != "" || !reflect.DeepEqual(got.DefaultModes, want) {
		t.Errorf("settings = %+v", got)
	}
}
