// Package archtest checks the layers of aibo: which of its packages each
// package may import. See docs/agents/conventions.md.
package archtest

import (
	"os/exec"
	"slices"
	"strings"
	"testing"
)

const module = "github.com/chldu2000/aibo/"

// allowed lists, for every package of the module, the packages of the
// module it may import (its non-test files). A package missing here fails:
// a new package takes its place in the layers deliberately.
var allowed = map[string][]string{
	"internal/agent":        {},
	"internal/agent/claude": {"internal/agent"},
	"internal/agent/codex":  {"internal/agent"},
	"internal/agent/fake":   {"internal/agent"},
	"internal/agents":       {"internal/agent", "internal/agent/claude", "internal/agent/codex"},
	"internal/appdata":      {},
	"internal/diag":         {},
	"internal/files":        {},
	"internal/model":        {"internal/agent"},
	"internal/refs":         {"internal/agent", "internal/model"},
	"internal/store":        {"internal/agent", "internal/model"},
	"internal/mcpserver":    {"internal/refs"},
	"internal/workbench":    {"internal/agent", "internal/files", "internal/mcpserver", "internal/model", "internal/refs", "internal/store"},
	"internal/shell":        {"internal/agent", "internal/agents", "internal/appdata", "internal/model", "internal/refs", "internal/workbench", "locales"},
	"internal/contract":     nil, // tests only
	"internal/archtest":     nil, // tests only
	"cmd/aibo":              {"*"},
	// The messages of the user's interface, which only the shell and the
	// app say: the layers below word nothing for the user.
	"locales": {},
}

func TestLayers(t *testing.T) {
	out, err := exec.Command("go", "list", "-f", `{{.ImportPath}}:{{join .Imports " "}}`, module+"...").Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		pkg, imports, _ := strings.Cut(line, ":")
		pkg = strings.TrimPrefix(pkg, module)
		ok, known := allowed[pkg]
		if !known {
			t.Errorf("%s is not in the layers: add it to allowed, with what it may import", pkg)
			continue
		}
		if slices.Contains(ok, "*") {
			continue
		}
		for _, imp := range strings.Fields(imports) {
			if dep, ours := strings.CutPrefix(imp, module); ours && !slices.Contains(ok, dep) {
				t.Errorf("%s imports %s, which its layer may not", pkg, dep)
			}
		}
	}
}
