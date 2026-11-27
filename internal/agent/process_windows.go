package agent

import (
	"context"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"golang.org/x/sys/windows"

	"github.com/chldu2000/aibo/internal/proc"
)

// BoundProcess hides a local Agent's console and cancels its process tree.
// The caller must create cmd with exec.CommandContext.
func BoundProcess(cmd *exec.Cmd) {
	proc.Hide(cmd)
	cmd.WaitDelay = time.Second
	cmd.Cancel = func() error {
		dir, err := windows.GetSystemDirectory()
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			kill := exec.CommandContext(ctx, filepath.Join(dir, "taskkill.exe"), "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
			proc.Hide(kill)
			if kill.Run() == nil {
				return nil
			}
		}
		return cmd.Process.Kill()
	}
}
