package main

import (
	"path/filepath"
	"testing"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agents"
	"github.com/chldu2000/aibo/internal/workbench"
)

func TestMigrateACPPath(t *testing.T) {
	dir := t.TempDir()
	open := func() *app {
		t.Helper()
		r, err := agents.Open(dir, agents.Options{})
		if err != nil {
			t.Fatal(err)
		}
		w, err := workbench.Open(workbench.Options{DataDir: dir, Agents: r.Agents()})
		if err != nil {
			t.Fatal(err)
		}
		return &app{reg: r, wb: w}
	}
	a := open()
	oldPath := filepath.Join(dir, "old", "opencode")
	if err := a.wb.SetPref("agentPaths", map[agent.Kind]string{agents.OpenCode: oldPath, "codex": "chosen"}); err != nil {
		t.Fatal(err)
	}
	if err := a.loadAgentPaths(); err != nil {
		t.Fatal(err)
	}
	cfg, _ := a.reg.ACPConfig(agents.OpenCode)
	if cfg.Command != oldPath {
		t.Fatalf("migrated command = %q", cfg.Command)
	}
	cfg.Command = "new-opencode"
	if _, err := a.reg.EditACP(cfg); err != nil {
		t.Fatal(err)
	}
	if err := a.wb.Close(); err != nil {
		t.Fatal(err)
	}
	a = open()
	defer a.wb.Close()
	if err := a.loadAgentPaths(); err != nil {
		t.Fatal(err)
	}
	cfg, _ = a.reg.ACPConfig(agents.OpenCode)
	if paths := a.reg.Paths(); cfg.Command != "new-opencode" || len(paths) != 1 || paths["codex"] != "chosen" {
		t.Fatalf("restart restored stale preferences: %q, %v", cfg.Command, paths)
	}
}
