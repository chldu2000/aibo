// Command aibo is the multi-Agent workbench.
//
//	CGO_ENABLED=0 go build -o aibo ./cmd/aibo && ./aibo
//
// AIBO_DATA_DIR replaces the data directory, by default
// ~/Library/Application Support/aibo. AIBO_DEMO=1 adds a scripted Agent.
package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func dataDir() (string, error) {
	if d := os.Getenv("AIBO_DATA_DIR"); d != "" {
		return filepath.Abs(d)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Application Support", "aibo"), nil
}

// find finds an Agent's executable on PATH or where it is usually
// installed: an app launched from the Dock has no shell PATH. Agent
// discovery proper (the login shell's PATH, versions, a chosen path) is
// ticket 15's.
func find(name string) (string, bool) {
	if p, err := exec.LookPath(name); err == nil {
		return p, true
	}
	home, _ := os.UserHomeDir()
	for _, dir := range []string{filepath.Join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"} {
		p := filepath.Join(dir, name)
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p, true
		}
	}
	return "", false
}

// notificationPrefix starts the IDs of approval notifications, before
// their sessions' IDs.
const notificationPrefix = "approval:"

func main() {
	dir, err := dataDir()
	if err != nil {
		log.Fatal(err)
	}
	var agents []agent.Agent
	if path, ok := find("claude"); ok {
		agents = append(agents, claude.New(path))
	}
	if path, ok := find("codex"); ok {
		agents = append(agents, codex.New(path))
	}
	// AIBO_DEMO=1 adds the scripted Agent, to try the workbench without
	// a real one.
	if os.Getenv("AIBO_DEMO") == "1" {
		agents = append(agents, fake.New(fake.Demo))
	}
	wb, err := workbench.Open(workbench.Options{DataDir: dir, Agents: agents})
	if err != nil {
		log.Fatalf("打开数据目录 %s 失败：%v", dir, err)
	}

	// win is set on the main thread and read from the workbench's.
	var win atomic.Pointer[mygo.Window]
	// Notifications need a packaged app; a bare binary goes without.
	var notify func(sessionID, title, body string)
	if mygo.NotificationsSupported() {
		notify = func(sessionID, title, body string) {
			mygo.NewNotification(mygo.NotificationOptions{ID: notificationPrefix + sessionID, Title: title, Body: body, Group: sessionID}).Show()
		}
	}
	sh := shell.New(wb, shell.Options{
		Notify: notify,
		Wake: func() {
			if w := win.Load(); w != nil {
				w.Invalidate()
			}
		},
		ChooseFolder: func() (string, bool) {
			paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win.Load(), Title: "添加工作区", ButtonLabel: "添加", Directory: true, CreateDirectories: true})
			if err != nil || len(paths) == 0 {
				return "", false
			}
			return paths[0], true
		},
	})
	// A notification opens its session, also after aibo was relaunched.
	mygo.App.OnNotificationClick(func(id string) {
		if sessionID, ok := strings.CutPrefix(id, notificationPrefix); ok {
			if w := win.Load(); w != nil {
				w.Update(func() { sh.Open(sessionID) })
				w.Focus()
			}
		}
	})
	mygo.App.WhenReady(func() {
		win.Store(mygo.NewWindow(mygo.WindowOptions{
			Title:         "aibo",
			Width:         1180,
			Height:        780,
			TitleBarStyle: mygo.TitleBarHiddenInset,
			Transparent:   true,
			Vibrancy:      mygo.VibrancySidebar,
			Content:       ui.View(sh.View),
		}))
	})
	runErr := mygo.App.Run()
	if err := wb.Close(); err != nil {
		log.Print(err)
	}
	if runErr != nil {
		log.Fatal(runErr)
	}
}
