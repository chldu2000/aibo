package agents

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
)

// cursorCommand is the Cursor CLI's executable. Its installer also names
// it agent, which aibo does not look for: too common a name.
const cursorCommand = "cursor-agent"

// cursorVersionRE is a version directory of a Cursor CLI install, as its
// own launcher (cursor-agent.ps1) picks them: staged updates (.new) and
// the version they replaced (.previous) are not one.
var cursorVersionRE = regexp.MustCompile(`^(\d{4})\.(\d{1,2})\.(\d{1,2})(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$`)

// cursorLauncher finds what the Cursor CLI's Windows launcher in dir runs.
// The install holds only scripts (cursor-agent.cmd and .ps1), which start
// versions\<newest>\node.exe index.js through PowerShell; aibo runs that
// node.exe itself, so that ending a session ends the Agent too. It leaves
// a staged update for the launcher to promote, the next time the user
// runs it.
func cursorLauncher(dir string) (exe string, pre []string, ok bool) {
	if _, err := os.Stat(filepath.Join(dir, cursorCommand+".cmd")); err != nil {
		return "", nil, false
	}
	entries, err := os.ReadDir(filepath.Join(dir, "versions"))
	if err != nil {
		return "", nil, false
	}
	type version struct {
		date        [3]int
		stamp, name string
	}
	var found []version
	for _, e := range entries {
		m := cursorVersionRE.FindStringSubmatch(e.Name())
		if !e.IsDir() || m == nil {
			continue
		}
		v := version{stamp: m[4], name: e.Name()}
		for i := range 3 {
			v.date[i], _ = strconv.Atoi(m[i+1])
		}
		found = append(found, v)
	}
	// Newest first: by date, then by the time a build is stamped with (one
	// stamped comes after the same day's without), then by name.
	slices.SortFunc(found, func(a, b version) int {
		if c := slices.Compare(b.date[:], a.date[:]); c != 0 {
			return c
		}
		if c := strings.Compare(b.stamp, a.stamp); c != 0 {
			return c
		}
		return strings.Compare(b.name, a.name)
	})
	for _, v := range found {
		if exe, pre, ok := cursorNode(filepath.Join(dir, "versions", v.name, "node.exe")); ok {
			return exe, pre, true
		}
	}
	return "", nil, false
}

// cursorNode is node.exe in a Cursor CLI version directory, with the
// script it runs.
func cursorNode(p string) (string, []string, bool) {
	dir := filepath.Dir(p)
	if !strings.EqualFold(filepath.Base(p), "node.exe") || !cursorVersionRE.MatchString(filepath.Base(dir)) || !executable(p) {
		return "", nil, false
	}
	script := filepath.Join(dir, "index.js")
	if fi, err := os.Stat(script); err != nil || !fi.Mode().IsRegular() {
		return "", nil, false
	}
	return p, []string{script}, true
}

// cursorLauncherOf is the launcher of the install a version's node.exe
// belongs to (versions\<version>\node.exe), if it is there: what the user
// runs in a terminal.
func cursorLauncherOf(node string) string {
	root := filepath.Dir(filepath.Dir(filepath.Dir(node)))
	p := filepath.Join(root, cursorCommand+".cmd")
	if _, err := os.Stat(p); err != nil || !strings.EqualFold(filepath.Base(filepath.Dir(filepath.Dir(node))), "versions") {
		return ""
	}
	return p
}

// cursorLogin asks the Cursor CLI how it is signed in (cursor-agent
// status --format json). It also says the account's email, which aibo
// does not show.
func cursorLogin(ctx context.Context, path string, pre, env []string) (State, string, Problem, string) {
	out, _, err := run(ctx, path, env, append(slices.Clone(pre), "status", "--format", "json")...)
	var s struct {
		IsAuthenticated *bool `json:"isAuthenticated"`
	}
	if json.Unmarshal([]byte(out), &s) != nil || s.IsAuthenticated == nil {
		if err != nil {
			return Broken, "", ProblemNoLogin, err.Error()
		}
		return Broken, "", ProblemBadLogin, strings.TrimSpace(out)
	}
	if !*s.IsAuthenticated {
		return NotLoggedIn, "", ProblemSignedOut, ""
	}
	return Ready, "", NoProblem, ""
}

// isCursorCommand reports whether p names the Cursor CLI's executable or
// launcher, as another Agent ID's command may.
func isCursorCommand(p string) bool {
	b, _ := builtin(Cursor)
	return runsBuiltin(b, p)
}

// cursorChosen is what runs for an executable the user chose for the
// Cursor CLI: on Windows its launcher or a version's node.exe, otherwise
// the executable itself.
func cursorChosen(p string) (string, []string, bool) {
	if runtime.GOOS != "windows" {
		return p, nil, executable(p)
	}
	switch strings.ToLower(filepath.Base(p)) {
	case cursorCommand + ".cmd", cursorCommand + ".ps1", "agent.cmd", "agent.ps1":
		return cursorLauncher(filepath.Dir(p))
	case "node.exe":
		return cursorNode(p)
	}
	return p, nil, executable(p)
}
