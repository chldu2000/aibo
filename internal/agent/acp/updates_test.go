package acp

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// Captured inbound frames of an allowed OpenCode 1.19.6 echo command.
func TestOpenCodeFrames(t *testing.T) {
	f, err := os.Open("testdata/opencode-1.19.6.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s := &session{active: 3, events: make(chan agent.Event, 32), id: "ses_deecb2940ffeb9bn7l3eRs0aFj", log: agent.Discard, pending: map[string]permission{}, tools: map[string]bool{}}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var m envelope
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatal(err)
		}
		if m.Method != "" {
			s.incoming(m)
		} else {
			s.response(m)
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	close(s.events)
	var tool string
	var asked, finished, done, ended bool
	var reply string
	for ev := range s.events {
		switch e := ev.(type) {
		case agent.ToolStarted:
			tool = e.ToolID
		case agent.ApprovalRequested:
			asked = e.ID == tool+"/0" && e.Command == "echo probe-allow" && len(e.Options) == 3 && e.ToolID == tool
		case agent.ToolFinished:
			finished = e.ToolID == tool && e.Output == "probe-allow\n" && e.ExitCode != nil && *e.ExitCode == 0 && !e.IsError
		case agent.ReplyDelta:
			reply += e.Text
		case agent.ReplyDone:
			done = true
		case agent.TurnEnded:
			ended = done && !e.Interrupted
		}
	}
	if tool == "" || !asked || !finished || reply != "probe-allow" || !ended {
		t.Fatalf("tool=%s asked=%v finished=%v reply=%q ended=%v", tool, asked, finished, reply, ended)
	}
}
