// Command refbench (probe for agent-extensibility 01) runs a real aibo
// workbench on a temporary data directory, with the fake Agent, to give
// OpenCode a real reference and real per-session MCP tokens.
//
// It makes, in WORKSPACE:
//   - src: a session whose second user message holds AMBER-7319;
//   - tgt: a session given a whole-session reference to src;
//   - other: a session given nothing;
//
// then appends a message holding LATE-4421 to src, after the reference was
// made. It prints one JSON line (the MCP URL, tgt's and other's tokens,
// the reference ID and the text aibo sent tgt with the reference) and
// serves until its stdin closes. The tokens are secrets: keep them out of
// recorded evidence.
//
// usage: go run ./.scratch/agent-extensibility/research/01-probes/refbench WORKSPACE
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/workbench"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: refbench WORKSPACE")
		os.Exit(2)
	}
	data, err := os.MkdirTemp("", "aibo-refbench-")
	check(err)
	defer os.RemoveAll(data)

	// Each session's text, as aibo sent it to the Agent, by start order.
	turns := make(chan agent.Turn, 16)
	f := fake.New(func(ctx context.Context, _ agent.StartOptions, t agent.Turn, emit func(agent.Event)) {
		turns <- t
		fake.Stream(ctx, emit, "r", "收到。", 0)
	})
	w, err := workbench.Open(workbench.Options{DataDir: data, Agents: []agent.Agent{f}})
	check(err)
	defer w.Close()

	ws, err := w.AddWorkspace(os.Args[1])
	check(err)
	newSession := func() string {
		s, err := w.NewSession(ws.ID, fake.Kind, "")
		check(err)
		return s.ID
	}
	send := func(id, text string) agent.Turn {
		check(w.Send(id, text))
		t := <-turns
		for w.Status(id).Running {
			time.Sleep(10 * time.Millisecond)
		}
		return t
	}

	src := newSession()
	// The brief shows the first user message and the last reply: the
	// secret sits between them, in the reference's body only.
	send(src, "我们准备部署。")
	send(src, "记一下：这次部署的暗号是 AMBER-7319。")
	send(src, "好，就这样。")
	tgt, other := newSession(), newSession()
	r, err := w.ReferenceSession(src, tgt)
	check(err)
	sent := send(tgt, "请读这条引用。")
	send(other, "你好。")
	send(src, "暗号改了，新的是 LATE-4421。")

	starts := f.Starts() // src, tgt, other
	out, _ := json.Marshal(map[string]string{
		"url":         starts[1].MCP.URL,
		"tgt_token":   starts[1].MCP.Token,
		"other_token": starts[2].MCP.Token,
		"ref_id":      r.ID,
		"tgt_text":    sent.Text,
	})
	fmt.Println(string(out))
	io.Copy(io.Discard, os.Stdin)
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
