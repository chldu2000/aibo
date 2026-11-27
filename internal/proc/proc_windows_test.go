package proc

import (
	"os/exec"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

func TestHideKeepsOtherFlags(t *testing.T) {
	cmd := exec.Command("git")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
	Hide(cmd)
	if f := cmd.SysProcAttr.CreationFlags; f&windows.CREATE_NO_WINDOW == 0 || f&windows.CREATE_NEW_PROCESS_GROUP == 0 {
		t.Fatalf("CreationFlags = %#x, want CREATE_NO_WINDOW and CREATE_NEW_PROCESS_GROUP", f)
	}
}

func TestHideWithoutAttributes(t *testing.T) {
	cmd := exec.Command("git")
	Hide(cmd)
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("SysProcAttr = %+v, want CREATE_NO_WINDOW", cmd.SysProcAttr)
	}
}
