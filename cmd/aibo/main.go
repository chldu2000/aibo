// Command aibo is the multi-Agent workbench.
//
//	CGO_ENABLED=0 go build -o aibo ./cmd/aibo && ./aibo
//
// AIBO_DATA_DIR replaces the data directory (and the config file's
// choice), for development. AIBO_DEMO=1 adds a scripted Agent.
package main

import (
	"errors"
	"fmt"
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
	"github.com/chldu2000/aibo/internal/appdata"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

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

// app is the running aibo.
type app struct {
	def     string // the default data directory, with the config file
	dir     string // the data directory in use
	release func() // releases the data directory's lock
	agents  []agent.Agent
	wb      *workbench.Workbench
	sh      *shell.Shell
	// win is set on the main thread and read from others.
	win      atomic.Pointer[mygo.Window]
	quitting atomic.Bool
}

func main() {
	// One aibo at a time: a second launch shows the first one's window.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	def, err := appdata.DefaultDir()
	if err != nil {
		log.Fatal(err)
	}
	a := &app{def: def}
	if path, ok := find("claude"); ok {
		a.agents = append(a.agents, claude.New(path))
	}
	if path, ok := find("codex"); ok {
		a.agents = append(a.agents, codex.New(path))
	}
	if os.Getenv("AIBO_DEMO") == "1" {
		a.agents = append(a.agents, fake.New(fake.Demo))
	}
	mygo.App.OnSecondInstance(func([]string, string) {
		if w := a.win.Load(); w != nil {
			w.Focus()
		}
	})
	mygo.App.OnBeforeQuit(a.beforeQuit)
	mygo.App.OnNotificationClick(func(id string) {
		if sessionID, ok := strings.CutPrefix(id, notificationPrefix); ok && a.sh != nil {
			if w := a.win.Load(); w != nil {
				w.Update(func() { a.sh.Open(sessionID) })
				w.Focus()
			}
		}
	})
	// The data directory is found, perhaps with the user's help, off the
	// main thread, where the dialogs wait.
	mygo.App.WhenReady(func() { go a.start() })
	runErr := mygo.App.Run()
	if a.wb != nil {
		if err := a.wb.Close(); err != nil {
			log.Print(err)
		}
	}
	if a.release != nil {
		a.release()
	}
	if runErr != nil {
		log.Fatal(runErr)
	}
}

// start opens the workbench on the data directory and shows the window.
// A data directory that is not there is never replaced by an empty one:
// the user tries again, chooses where it is, or quits.
func (a *app) start() {
	for {
		dir, err := a.resolve()
		var release func()
		if err == nil {
			release, err = appdata.Lock(dir)
		}
		if err == nil {
			a.wb, err = workbench.Open(workbench.Options{DataDir: dir, Agents: a.agents})
			if err != nil {
				release()
			}
		}
		if err == nil {
			a.dir, a.release = dir, release
			break
		}
		switch a.ask(err) {
		case retry:
		case reselect:
			a.reselect()
		default:
			mygo.App.Quit()
			return
		}
	}
	mygo.RunOnMain(a.show)
}

func (a *app) resolve() (string, error) {
	if d := os.Getenv("AIBO_DATA_DIR"); d != "" {
		d, _ = filepath.Abs(d)
		return d, os.MkdirAll(d, 0o755)
	}
	c, err := appdata.LoadConfig(a.def)
	if err != nil {
		return "", err
	}
	return appdata.Resolve(a.def, c)
}

type choice int

const (
	retry choice = iota
	reselect
	quit
)

// ask says why the data directory cannot be opened, and asks what to do.
func (a *app) ask(err error) choice {
	buttons := []string{"重试", "重新选择位置", "退出"}
	detail := "aibo 不会在别处新建一个空的数据目录。请检查磁盘是否已连接，或者选择数据目录现在所在的位置。"
	if errors.Is(err, appdata.ErrLocked) {
		buttons = []string{"重试", "退出"}
		detail = "同一个数据目录同时只能由一个 aibo 使用。请先退出另一个 aibo。"
	}
	r, derr := mygo.Dialog.Message(mygo.MessageOptions{Type: mygo.MessageWarning, Title: "aibo",
		Message: err.Error(), Detail: detail, Buttons: buttons, DefaultButton: 0, CancelButton: len(buttons) - 1})
	if derr != nil {
		return quit
	}
	switch {
	case r.Button == 0:
		return retry
	case len(buttons) == 3 && r.Button == 1:
		return reselect
	}
	return quit
}

// reselect lets the user say where the data directory is now.
func (a *app) reselect() {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: "选择数据目录", ButtonLabel: "使用这个文件夹", Directory: true, CreateDirectories: true})
	if err != nil || len(paths) == 0 {
		return
	}
	p := paths[0]
	if !appdata.HasData(p) {
		r, err := mygo.Dialog.Message(mygo.MessageOptions{Type: mygo.MessageWarning, Title: "aibo",
			Message: "这个文件夹里没有 aibo 的数据", Detail: p + "\n\n使用它，aibo 将从空白开始；原来的数据不在这里。",
			Buttons: []string{"从空白开始", "取消"}, DefaultButton: 1, CancelButton: 1})
		if err != nil || r.Button != 0 {
			return
		}
	}
	if err := appdata.SaveConfig(a.def, appdata.Config{DataDir: p}); err != nil {
		log.Print(err)
	}
}

// show opens the window. It runs on the main thread.
func (a *app) show() {
	// Notifications need a packaged app; a bare binary goes without.
	var notify func(sessionID, title, body string)
	if mygo.NotificationsSupported() {
		notify = func(sessionID, title, body string) {
			mygo.NewNotification(mygo.NotificationOptions{ID: notificationPrefix + sessionID, Title: title, Body: body, Group: sessionID}).Show()
		}
	}
	a.sh = shell.New(a.wb, shell.Options{
		Notify:       notify,
		DataDir:      a.dir,
		MoveDataDir:  a.moveDataDir,
		ShowInFinder: mygo.Shell.ShowItemInFolder,
		Wake: func() {
			if w := a.win.Load(); w != nil {
				w.Invalidate()
			}
		},
		ChooseFolder: func() (string, bool) {
			paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: a.win.Load(), Directory: true, CreateDirectories: true})
			if err != nil || len(paths) == 0 {
				return "", false
			}
			return paths[0], true
		},
	})
	a.win.Store(mygo.NewWindow(mygo.WindowOptions{
		Title:         "aibo",
		Width:         1180,
		Height:        780,
		TitleBarStyle: mygo.TitleBarHiddenInset,
		Transparent:   true,
		Vibrancy:      mygo.VibrancySidebar,
		Content:       ui.View(a.sh.View),
	}))
}

// moveDataDir moves the data to the directory to and starts aibo again
// on it. The workbench closes first: the database must be closed.
func (a *app) moveDataDir(to string) error {
	if os.Getenv("AIBO_DATA_DIR") != "" {
		return errors.New("数据目录由环境变量 AIBO_DATA_DIR 指定，不能在这里更改")
	}
	if err := a.wb.Close(); err != nil {
		return err
	}
	a.release()
	if err := appdata.Move(a.dir, to); err != nil {
		// Nothing moved: aibo starts again where it was.
		a.quitting.Store(true)
		mygo.App.Relaunch()
		return err
	}
	c := appdata.Config{DataDir: to}
	if filepath.Clean(to) == filepath.Clean(a.def) {
		c.DataDir = ""
	}
	if err := appdata.SaveConfig(a.def, c); err != nil {
		return err
	}
	a.quitting.Store(true)
	mygo.App.Relaunch()
	return nil
}

// beforeQuit asks first when sessions run: their turns would be cut
// short (and saved as interrupted).
func (a *app) beforeQuit(e *mygo.QuitEvent) {
	if a.wb == nil || e.SessionEnding || a.quitting.Load() {
		return
	}
	n := 0
	for _, x := range a.wb.Sessions() {
		if a.wb.Status(x.ID).Running {
			n++
		}
	}
	if n == 0 {
		return
	}
	e.PreventDefault()
	go func() {
		r, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: a.win.Load(), Type: mygo.MessageWarning,
			Message: fmt.Sprintf("有 %d 个会话正在运行，确定退出吗？", n),
			Detail:  "退出会中断它们：正在进行的回复保存为“已中断”，还没处理的审批视为拒绝。",
			Buttons: []string{"退出", "取消"}, DefaultButton: 1, CancelButton: 1})
		if err == nil && r.Button == 0 {
			a.quitting.Store(true)
			mygo.App.Quit()
		}
	}()
}
