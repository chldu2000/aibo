//go:build !windows

package proc

import "os/exec"

// Hide does nothing here: only Windows opens a window for a program a GUI
// app starts.
func Hide(cmd *exec.Cmd) {}
