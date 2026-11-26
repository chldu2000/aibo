package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

var id = 0
var in *json.Encoder
var out *bufio.Scanner

func call(method string, params any) map[string]any {
	id++
	in.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	for out.Scan() {
		var m map[string]any
		json.Unmarshal(out.Bytes(), &m)
		if v, ok := m["id"].(float64); ok && int(v) == id && m["method"] == nil {
			if m["error"] != nil {
				fmt.Println("ERROR", method, m["error"])
			}
			r, _ := m["result"].(map[string]any)
			return r
		}
		if m["method"] != nil {
			b, _ := json.Marshal(m)
			s := string(b)
			if len(s) > 400 { s = s[:400] }
			fmt.Println("NOTE", s)
		}
	}
	return nil
}

func show(r map[string]any) {
	opts, _ := r["configOptions"].([]any)
	for _, o := range opts {
		m := o.(map[string]any)
		vals := []string{}
		for _, x := range m["options"].([]any) {
			xm := x.(map[string]any)
			if g, ok := xm["options"]; ok { // grouped
				for _, y := range g.([]any) { vals = append(vals, y.(map[string]any)["value"].(string)) }
			} else {
				vals = append(vals, fmt.Sprint(xm["value"]))
			}
		}
		fmt.Printf("OPTION id=%v category=%v current=%v n=%d\n  %s\n", m["id"], m["category"], m["currentValue"], len(vals), strings.Join(vals, " | "))
	}
	keys := []string{}
	for k := range r { keys = append(keys, k) }
	fmt.Println("KEYS", keys)
}

func main() {
	cmd := exec.Command(os.Args[1], "acp")
	cmd.Dir = os.Args[2]
	w, _ := cmd.StdinPipe()
	rd, _ := cmd.StdoutPipe()
	cmd.Start()
	defer cmd.Process.Kill()
	in = json.NewEncoder(w)
	out = bufio.NewScanner(rd)
	out.Buffer(make([]byte, 1<<20), 1<<24)
	init := call("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	b, _ := json.Marshal(init["agentCapabilities"]); fmt.Println("CAPS", string(b))
	r := call("session/new", map[string]any{"cwd": os.Args[2], "mcpServers": []any{}})
	show(r)
	sid := r["sessionId"]
	for _, m := range os.Args[3:] {
		fmt.Println("== set model", m)
		show(call("session/set_config_option", map[string]any{"sessionId": sid, "configId": "model", "value": m}))
	}
	_ = time.Second
}
