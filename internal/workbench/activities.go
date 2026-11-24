package workbench

import (
	"strconv"

	"github.com/chldu2000/aibo/internal/model"
)

type ActivityKind string

const Commands ActivityKind = "commands"

func ActivityOf(name string) ActivityKind {
	switch name {
	case "Bash", "shell":
		return Commands
	}
	return ""
}

// Activity identifies a recorded call within a session snapshot. Child
// positions are stable because children are appended in arrival order.
type Activity struct {
	ID      string
	Message model.Message
	Active  bool
}

// Activities projects an existing Messages snapshot, newest parent first.
// A child left streaming in a recovered or completed parent is historical.
func Activities(msgs []model.Message, kind ActivityKind) []Activity {
	var result []Activity
	var visit func(model.Message, string, bool)
	visit = func(m model.Message, id string, liveParent bool) {
		active := liveParent && m.State == model.Streaming
		if m.Tool != nil && ActivityOf(m.Tool.Name) == kind {
			result = append(result, Activity{ID: id, Message: m, Active: active})
		}
		for i, child := range m.Children {
			visit(child, id+"."+strconv.Itoa(i+1), active)
		}
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Tool != nil {
			visit(msgs[i], strconv.Itoa(msgs[i].Seq), true)
		}
	}
	return result
}
