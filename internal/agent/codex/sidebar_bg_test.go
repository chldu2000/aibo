package codex

import (
	"bufio"
	"encoding/json"
	"os"
	"testing"
)

func TestRecordedBackgroundLifecycle(t *testing.T) {
	f, err := os.Open("testdata/sidebar-background-0.172.0.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	scan := bufio.NewScanner(f)
	var id, declined string
	var live, ended, reconnected bool
	for scan.Scan() {
		var r struct {
			Method      string
			Observation string
			Params      struct {
				ThreadID, ItemID string
				Item             item
				TurnEnded        bool
				Data             struct {
					Data []struct{ ItemID, ProcessID string }
				}
				Error struct{ Code int }
			}
		}
		if err := json.Unmarshal(scan.Bytes(), &r); err != nil {
			t.Fatal(err)
		}
		p := r.Params
		if r.Observation != "" {
			r.Method = "probe/" + r.Observation
		}
		switch r.Method {
		case "item/started":
			if id == "" {
				id = p.Item.ID
			}
		case "probe/decline":
			declined = p.ItemID
		case "item/completed":
			if p.Item.ID == declined && declined != "" && p.Item.Status != "declined" {
				t.Fatal(p.Item)
			}
		case "probe/background":
			if p.TurnEnded && len(p.Data.Data) == 1 && p.Data.Data[0].ItemID == id && p.Data.Data[0].ProcessID != "" {
				live = true
			}
			if live && p.TurnEnded && len(p.Data.Data) == 0 {
				ended = true
			}
		case "probe/reconnect":
			reconnected = p.Error.Code != 0
		}
	}
	if err := scan.Err(); err != nil {
		t.Fatal(err)
	}
	if !(live && ended && reconnected && declined != "") {
		t.Fatal(live, ended, reconnected, declined)
	}
}
