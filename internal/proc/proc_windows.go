package proc

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// Hide keeps cmd from opening a console window. A GUI app has no console
// of its own, so Windows gives every console program it starts a new one,
// which flashes up on the desktop.
func Hide(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW
}
