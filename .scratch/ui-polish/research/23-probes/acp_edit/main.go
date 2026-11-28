// Probe (task 23): what an ACP Agent (OpenCode, the Cursor CLI) says of a
// turn that changes files: one modified, one created. The executable is
// found as aibo finds it; every permission asked is allowed once; every
// line both ways is recorded.
//
// usage: go run ./.scratch/ui-polish/research/23-probes/acp_edit OUT.jsonl WORKDIR opencode|cursor
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	registry "github.com/chldu2000/aibo/internal/agents"
)

func main() {
	out, cwd, kind := os.Args[1], os.Args[2], agent.Kind(os.Args[3])
	r := registry.New(registry.Options{})
	ctx := context.Background()
	r.Check(ctx, kind)
	st := r.Status(kind)
	cfg, _ := r.ACPConfig(kind)
	if st.Path == "" {
		panic(fmt.Sprintf("%s: %+v", kind, st))
	}
	fmt.Println(kind, st.Version, st.Path, st.Args, cfg.Args)
	log, err := os.Create(out)
	if err != nil {
		panic(err)
	}
	defer log.Close()
	cmd := exec.Command(st.Path, append(slices.Clone(st.Args), cfg.Args...)...)
	cmd.Dir = cwd
	in, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		panic(err)
	}
	defer cmd.Process.Kill()
	lines := make(chan map[string]any, 4096)
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 1<<20), 1<<26)
		for sc.Scan() {
			fmt.Fprintln(log, sc.Text())
			var m map[string]any
			if json.Unmarshal(sc.Bytes(), &m) == nil {
				lines <- m
			}
		}
		close(lines)
	}()
	send := func(o map[string]any) {
		o["jsonrpc"] = "2.0"
		b, _ := json.Marshal(o)
		fmt.Fprintln(log, ">> "+string(b))
		in.Write(append(b, '\n'))
	}
	// answer allows a permission once; other requests have no method here.
	answer := func(m map[string]any) {
		if m["method"] != "session/request_permission" {
			send(map[string]any{"id": m["id"], "error": map[string]any{"code": -32601, "message": "not supported"}})
			return
		}
		params, _ := m["params"].(map[string]any)
		opts, _ := params["options"].([]any)
		chosen := ""
		for _, o := range opts {
			o, _ := o.(map[string]any)
			if o["kind"] == "allow_once" || chosen == "" && o["kind"] == "allow_always" {
				chosen, _ = o["optionId"].(string)
			}
		}
		send(map[string]any{"id": m["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": chosen}}})
	}
	n := 0
	req := func(method string, params any, wait time.Duration) map[string]any {
		n++
		id := float64(n)
		send(map[string]any{"id": n, "method": method, "params": params})
		guard := time.After(wait)
		for {
			select {
			case m, ok := <-lines:
				if !ok {
					panic("closed")
				}
				if m["id"] == id && m["method"] == nil {
					return m
				}
				if m["method"] != nil && m["id"] != nil {
					answer(m)
				}
			case <-guard:
				panic("timed out: " + method)
			}
		}
	}
	req("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}, "clientInfo": map[string]any{"name": "aibo-probe", "version": "0"}}, time.Minute)
	s := req("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}}, 2*time.Minute)
	res, _ := s["result"].(map[string]any)
	if res == nil {
		panic(fmt.Sprint("session/new: ", s))
	}
	ask := "Using your file editing tools only (no shell commands): in a.txt replace the line 'two' with 'TWO'; then create b.txt with the two lines 'hello' and 'world'. Then reply DONE."
	p := req("session/prompt", map[string]any{"sessionId": res["sessionId"], "prompt": []any{map[string]any{"type": "text", "text": ask}}}, 5*time.Minute)
	fmt.Println("prompt:", p["result"], p["error"])
}
