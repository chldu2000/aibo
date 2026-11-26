package agent

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// The probe and the child it started must both exit on cancellation.
func TestCancelProbeTree(t *testing.T) {
	const role = "AIBO_TEST_PROBE_ROLE"
	switch os.Getenv(role) {
	case "child":
		time.Sleep(30 * time.Second)
		return
	case "parent":
		child := exec.Command(os.Args[0], "-test.run=^TestCancelProbeTree$")
		child.Env = append(os.Environ(), role+"=child")
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		fmt.Println(child.Process.Pid)
		child.Wait()
		return
	}

	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestCancelProbeTree$")
	cmd.Env = append(os.Environ(), role+"=parent")
	BoundProcess(cmd)
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	var pid uint32
	if _, err := fmt.Fscan(bufio.NewReader(out), &pid); err != nil {
		cancel()
		cmd.Wait()
		t.Fatal(err)
	}
	child, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	cancel()
	cmd.Wait()
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(child)
	if state, err := windows.WaitForSingleObject(child, 2000); err != nil || state != windows.WAIT_OBJECT_0 {
		t.Fatalf("probe child still running: wait = %d, %v", state, err)
	}
}
