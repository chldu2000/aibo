package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"github.com/chldu2000/aibo/internal/agent"
	"os"
	"testing"
)

type recordedChildRPC struct {
	t         *testing.T
	responses map[[3]string]json.RawMessage
	calls     []string
}

func (r *recordedChildRPC) call(_ context.Context, method string, args, out any) error {
	p := args.(map[string]any)
	child := p["threadId"].(string)
	cursor, _ := p["cursor"].(string)
	r.calls = append(r.calls, method)
	if method == "thread/turns/list" && (p["itemsView"] != "full" || p["sortDirection"] != "asc") {
		r.t.Fatal(p)
	}
	data, ok := r.responses[[3]string{method, child, cursor}]
	if !ok {
		r.t.Fatal("unexpected RPC", method, p)
	}
	return json.Unmarshal(data, out)
}

func TestRecordedChildHistory(t *testing.T) {
	rpc := &recordedChildRPC{t: t, responses: map[[3]string]json.RawMessage{}}
	f, err := os.Open("testdata/sidebar-children-0.172.0.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scan := bufio.NewScanner(f)
	p := newThread()
	children := map[string]string{}
	for scan.Scan() {
		var row struct {
			Method, Request string
			Params, Result  json.RawMessage
		}
		if err := json.Unmarshal(scan.Bytes(), &row); err != nil {
			t.Fatal(err)
		}
		if row.Method != "" {
			for _, ev := range p.handle(row.Method, row.Params) {
				if e, ok := ev.(agent.ToolStarted); ok {
					children[e.ChildThread] = e.NativeThread
				}
			}
		} else {
			var params struct{ ThreadID, Cursor string }
			if err := json.Unmarshal(row.Params, &params); err != nil {
				t.Fatal(err)
			}
			rpc.responses[[3]string{row.Request, params.ThreadID, params.Cursor}] = row.Result
		}
	}
	if err := scan.Err(); err != nil {
		t.Fatal(err)
	}
	if len(children) != 2 {
		t.Fatal(children)
	}
	ctx := context.Background()
	for id, parent := range children {
		first, err := readChildPage(ctx, rpc, parent, id, "", 1)
		if err != nil || len(first.Entries) != 1 {
			t.Fatal(first, err)
		}
		if id == "child-1" {
			if first.Entries[0].Text != "AIBO_CHILD_ONE" || first.Next == "" {
				t.Fatal(first)
			}
			next, err := readChildPage(ctx, rpc, parent, id, first.Next, 1)
			if err != nil || len(next.Entries) != 1 || next.Entries[0].Text != "AIBO_SECOND_PAGE" || next.Next != "" {
				t.Fatal(next, err)
			}
		} else if first.Entries[0].Text != "AIBO_CHILD_TWO" || first.Next != "" {
			t.Fatal(first)
		}
	}
	rpc.calls = nil
	if _, err := readChildPage(ctx, rpc, "another-parent", "child-1", "", 1); err == nil || len(rpc.calls) != 1 || rpc.calls[0] != "thread/read" {
		t.Fatal(err, rpc.calls)
	}
}
