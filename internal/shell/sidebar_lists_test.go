package shell_test

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/ui"
)

// A workspace shows its 8 most recent sessions, and those that need
// looking at, until asked for all; folded, it counts what runs, and stays
// folded for the next launch.
func TestSidebarLists(t *testing.T) {
	release := make(chan struct{})
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		if turn.Text == "wait" {
			select {
			case <-release:
			case <-ctx.Done():
			}
		}
		emit(agent.ReplyDone{ReplyID: "r", Text: "ok"})
	}
	// Each session made a second after the one before, so that the most
	// recent are known.
	var mu sync.Mutex
	at := time.Now()
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		at = at.Add(time.Second)
		return at
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	defer close(release)
	changes := make(chan struct{}, 1024)
	wb.Subscribe(func(workbench.Change) {
		select {
		case changes <- struct{}{}:
		default:
		}
	})
	ws, _ := wb.AddWorkspace(t.TempDir())
	name := filepath.Base(ws.Path)
	ids := make([]string, 12)
	for i := range ids {
		x, _ := wb.NewSession(ws.ID, fake.Kind, "")
		wb.Rename(x.ID, fmt.Sprintf("session %02d", i))
		ids[i] = x.ID
	}
	tt := ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 1000)
	frame(tt)
	shown := func(want ...int) {
		t.Helper()
		for i := range ids {
			w := false
			for _, j := range want {
				w = w || i == j
			}
			// In the sidebar, not the open session's header.
			r, ok := tt.Find(fmt.Sprintf("session %02d", i))
			if got := ok && r.X < 300; got != w {
				t.Errorf("session %02d shown = %v, want %v", i, got, w)
			}
		}
	}
	recent := []int{4, 5, 6, 7, 8, 9, 10, 11}
	shown(recent...)
	if !tt.HasText("显示更多（4）") {
		t.Fatalf("no line for the others: %q", tt.Texts())
	}

	// The list goes by activity: one that replied comes first.
	wb.Send(ids[0], "hi")
	for wb.Status(ids[0]).Running {
		<-changes
	}
	frame(tt)
	recent = []int{0, 5, 6, 7, 8, 9, 10, 11}
	shown(recent...)

	// Shown all, an older one opened, it stays once fewer show.
	click(t, tt, "显示更多（4） · "+name)
	shown(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
	click(t, tt, "session 02")
	click(t, tt, "收起 · "+name)
	shown(append(recent, 2)...)
	if !tt.HasText("显示更多（3）") {
		t.Errorf("the line does not count the others: %q", tt.Texts())
	}

	// Folded, it counts what runs.
	wb.Send(ids[5], "wait")
	click(t, tt, "收起 "+name)
	shown()
	if !tt.HasText("1 个运行中") {
		t.Errorf("the folded workspace does not count what runs: %q", tt.Texts())
	}
	tt = ui.NewTester(shell.New(wb, shell.Options{}).View, 1100, 1000)
	frame(tt)
	shown()
	click(t, tt, "展开 "+name)
	if !tt.HasText("session 11") {
		t.Errorf("unfolding shows nothing: %q", tt.Texts())
	}
}
