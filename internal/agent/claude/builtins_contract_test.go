package claude

import (
	"bufio"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"
)

// Every built-in the claude on this machine tells is ruled on
// (AIBO_CONTRACT=1): one an upgrade added waits for a ruling in builtins
// or ruledOut, and is not offered meanwhile.
func TestContractBuiltinsRuledOn(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to run against the real claude")
	}
	path, err := exec.LookPath("claude")
	if err != nil {
		t.Skip("no claude on PATH")
	}
	cmd := exec.Command(path, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose")
	cmd.Dir = t.TempDir()
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stdin.Close()
		cmd.Process.Kill()
		cmd.Wait()
	}()
	b, _ := json.Marshal(map[string]any{"type": "control_request", "request_id": "init", "request": map[string]any{"subtype": "initialize"}})
	stdin.Write(append(b, '\n'))
	done := make(chan []command, 1)
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(nil, 16<<20)
		for sc.Scan() {
			var e struct {
				Type     string `json:"type"`
				Response struct {
					RequestID string `json:"request_id"`
					Response  struct {
						Commands []command `json:"commands"`
					} `json:"response"`
				} `json:"response"`
			}
			if json.Unmarshal(sc.Bytes(), &e) == nil && e.Type == "control_response" && e.Response.RequestID == "init" {
				done <- e.Response.Response.Commands
				return
			}
		}
		done <- nil
	}()
	var told []command
	select {
	case told = <-done:
	case <-time.After(time.Minute):
		t.Fatal("no answer to initialize")
	}
	if len(told) == 0 {
		t.Fatal("no commands told")
	}
	seen := map[string]bool{}
	for _, c := range told {
		if !c.Builtin {
			continue
		}
		seen[c.Name] = true
		if _, ok := builtins[c.Name]; !ok && !ruledOut[c.Name] {
			t.Errorf("/%s (%s) is not ruled on: rule on it in builtins or ruledOut", c.Name, c.Description)
		}
	}
	for name := range builtins {
		if !seen[name] {
			t.Logf("/%s is ruled on but no longer told", name)
		}
	}
}
