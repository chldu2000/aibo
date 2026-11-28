// Probe (task 10): what Codex's app-server says of a turn that changes
// files: one modified, one created, one deleted, with apply_patch. No
// approvals are asked (approvalPolicy never, workspace-write); every line
// is recorded.
//
// usage: go run ./.scratch/ui-polish/research/10-probes/codex_edit OUT.jsonl WORKDIR
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"time"
)

func main() {
	out, cwd := os.Args[1], os.Args[2]
	log, err := os.Create(out)
	if err != nil {
		panic(err)
	}
	defer log.Close()
	cmd := exec.Command("codex", "app-server")
	cmd.Dir = cwd
	in, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		panic(err)
	}
	defer cmd.Process.Kill()
	lines := make(chan map[string]any, 1024)
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 1<<20), 1<<24)
		for sc.Scan() {
			fmt.Fprintln(log, sc.Text())
			var m map[string]any
			if json.Unmarshal(sc.Bytes(), &m) == nil {
				lines <- m
			}
		}
		close(lines)
	}()
	send := func(o any) {
		b, _ := json.Marshal(o)
		fmt.Fprintln(log, ">> "+string(b))
		in.Write(append(b, '\n'))
	}
	n := 0
	req := func(method string, params any) map[string]any {
		n++
		id := float64(n)
		send(map[string]any{"id": n, "method": method, "params": params})
		for m := range lines {
			if m["id"] == id && m["method"] == nil {
				return m
			}
		}
		panic("closed")
	}
	req("initialize", map[string]any{"clientInfo": map[string]any{"name": "aibo-probe", "version": "0"}, "capabilities": map[string]any{"experimentalApi": true}})
	send(map[string]any{"method": "initialized"})
	t := req("thread/start", map[string]any{"cwd": cwd, "sandbox": "workspace-write", "approvalPolicy": "never"})
	thread := t["result"].(map[string]any)["thread"].(map[string]any)["id"]
	ask := "Using apply_patch only, in one patch if you can: in a.txt replace the line 'two' with 'TWO'; create b.txt with the lines 'hello' and 'world'; delete c.txt. Do not run any other commands. Then reply DONE."
	r := req("turn/start", map[string]any{"threadId": thread, "input": []any{map[string]any{"type": "text", "text": ask, "text_elements": []any{}}}})
	if r["error"] != nil {
		fmt.Println("ERROR", r["error"])
		return
	}
	end := time.After(5 * time.Minute)
	for {
		select {
		case m, ok := <-lines:
			if !ok {
				return
			}
			if m["method"] != nil && m["id"] != nil {
				// A request: decline it.
				send(map[string]any{"id": m["id"], "result": map[string]any{"decision": "decline"}})
			}
			if m["method"] == "turn/completed" {
				fmt.Println("turn completed")
				return
			}
		case <-end:
			fmt.Println("timed out")
			return
		}
	}
}
