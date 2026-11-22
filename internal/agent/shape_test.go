package agent_test

import (
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
)

// What the log says of a message an adapter does not know: its fields'
// names, never their values.
func TestShapeKeepsNamesOnly(t *testing.T) {
	got := agent.Shape([]byte(`{"type":"new_thing","text":"the secret word is pelican","token":"sk-123","nested":{"a":1}}`))
	if got != "nested,text,token,type" {
		t.Errorf("shape = %q", got)
	}
	if agent.Shape([]byte(`"just a string"`)) != "" || agent.Shape([]byte(`not json`)) != "" {
		t.Error("a shape of something not an object")
	}
}
