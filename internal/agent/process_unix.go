//go:build unix

package agent

import (
	"os/exec"
	"syscall"
	"time"
)

// BoundProcess makes a command's timeout end it with all it started: in a
// process group of its own, killed whole, and not waited for longer
// than a moment by output a child still holds open.
func BoundProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
}
