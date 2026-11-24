package agents

import (
	"context"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// The agent may have launched other processes that still hold its pipes.
func bounded(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
	cmd.WaitDelay = time.Second
	cmd.Cancel = func() error {
		dir, err := windows.GetSystemDirectory()
		if err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			kill := exec.CommandContext(ctx, filepath.Join(dir, "taskkill.exe"), "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
			kill.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
			if kill.Run() == nil {
				return nil
			}
		}
		return cmd.Process.Kill()
	}
}
