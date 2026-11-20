// Command aibo is the multi-Agent workbench.
//
//	CGO_ENABLED=0 go build -o aibo ./cmd/aibo && ./aibo
//
// AIBO_DATA_DIR replaces the data directory, by default
// ~/Library/Application Support/aibo.
package main

import (
	"log"
	"os"
	"path/filepath"
	"sync/atomic"

	"github.com/chldu2000/aibo/internal/agent"
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

func main() {
	dir, err := dataDir()
	if err != nil {
		log.Fatal(err)
	}
	// Until the real adapters land, the demo's scripted Agent answers.
	agents := []agent.Agent{fake.New(fake.Demo)}
	wb, err := workbench.Open(workbench.Options{DataDir: dir, Agents: agents})
	if err != nil {
		log.Fatalf("打开数据目录 %s 失败：%v", dir, err)
	}

	// win is set on the main thread and read from the workbench's.
	var win atomic.Pointer[mygo.Window]
	sh := shell.New(wb, shell.Options{
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
