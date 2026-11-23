package contract

import (
	"context"
	"os"
	"testing"

	registry "github.com/chldu2000/aibo/internal/agents"
)

// The Agents on this machine are found, new enough and signed in, as an
// app launched from the Dock would find them: with the PATH it gets.
func TestContractDiscovery(t *testing.T) {
	if os.Getenv("AIBO_CONTRACT") != "1" {
		t.Skip("set AIBO_CONTRACT=1 to look for the real Agents")
	}
	t.Setenv("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")     // launchd's
	r := registry.New(registry.Options{Dirs: []string{}}) // only the login shell
	r.Detect(context.Background())
	for _, s := range r.Statuses() {
		t.Logf("%s: state %d, %s (source %d), version %s, %s problem %d %s", s.Name, s.State, s.Path, s.Source, s.Version, s.Auth, s.Problem, s.Detail)
		if s.State != registry.Ready || s.Source != registry.SourcePath {
			t.Errorf("%s is not ready: %+v", s.Name, s)
		}
	}
}
