package contract

import (
	"context"
	"os"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	registry "github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestContractModels(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to ask the real Agents")
	}
	r := registry.New(registry.Options{})
	r.Detect(context.Background())
	w, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: r.Agents()})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	for _, a := range r.Agents() {
		if !w.TellsModels(a.Kind()) {
			continue
		}
		ms, err := w.Models(context.Background(), a.Kind())
		if err != nil || len(ms) < 2 || ms[0].ID != "" {
			t.Errorf("%s: %v, %+v", a.Kind(), err, ms)
		}
		var names []string
		for _, m := range ms {
			names = append(names, m.Name+"="+m.ID)
		}
		t.Logf("%s: %v", a.Kind(), names)
	}
	_ = agent.Model{}
}
