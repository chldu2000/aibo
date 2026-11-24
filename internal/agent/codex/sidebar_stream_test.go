package codex

import (
	"encoding/json"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestRecordedConcurrentCommandOutput(t *testing.T) {
	r := load(t, "sidebar-command-0.172.0")
	parser := newThread()
	chunks := map[string]string{}
	completions := 0
	for _, row := range r.turns[0] {
		var packet struct {
			Method string
			Params json.RawMessage
		}
		if err := json.Unmarshal([]byte(row), &packet); err != nil {
			t.Fatal(err)
		}
		for _, ev := range parser.handle(packet.Method, packet.Params) {
			switch e := ev.(type) {
			case agent.ToolOutputDelta:
				chunks[e.ToolID] += e.Text
			case agent.ToolFinished:
				if chunks[e.ToolID] != e.Output {
					t.Fatalf("mixed or lost output: %v %q", e, chunks[e.ToolID])
				}
				completions++
			}
		}
	}
	if len(chunks) != 2 || completions != 3 {
		t.Fatalf("chunks %v, completions %d", chunks, completions)
	}
	msgs, _ := run(t, r)
	calls := workbench.Activities(msgs, workbench.Commands)
	if len(calls) != 3 {
		t.Fatal(calls)
	}
	seen := map[string]bool{}
	for _, a := range calls {
		seen[a.Message.Tool.Output] = true
	}
	for _, out := range []string{"", "AIBO_OTHER\r\nAIBO_END\r\n", "AIBO_ONE\r\nAIBO_TWO\r\n"} {
		if !seen[out] {
			t.Fatal(seen)
		}
	}
}

func TestCommandChunkRequiresMatchingActiveTurn(t *testing.T) {
	p := newThread()
	p.handle("item/started", json.RawMessage(`{"turnId":"a","item":{"type":"commandExecution","id":"c"}}`))
	wrong := json.RawMessage(`{"turnId":"b","itemId":"c","delta":"late"}`)
	if got := p.handle("item/commandExecution/outputDelta", wrong); len(got) != 0 {
		t.Fatal(got)
	}
	p.handle("turn/completed", json.RawMessage(`{"turn":{"status":"interrupted"}}`))
	if got := p.handle("item/commandExecution/outputDelta", json.RawMessage(`{"turnId":"a","itemId":"c","delta":"late"}`)); len(got) != 0 {
		t.Fatal(got)
	}
}
