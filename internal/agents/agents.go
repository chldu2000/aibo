// Package agents finds the Agents installed on this computer, checks that
// they are new enough and signed in, and keeps their adapters pointed at
// them. aibo only runs the user's own, unmodified executables, and never
// installs one, signs in for Claude Code, or reads its credentials.
package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/acp"
	"github.com/chldu2000/aibo/internal/agent/claude"
	"github.com/chldu2000/aibo/internal/agent/codex"
)

// Spec is what aibo knows of an Agent before finding it.
type Spec struct {
	Kind agent.Kind
	Name string
	// Command is the executable's name.
	Command string
	// MinVersion is the oldest version aibo was tested with.
	MinVersion string
	// InstallURL is the official install instructions.
	InstallURL string
	// Glyph is its icon, an SVG drawn for aibo: never the vendor's logo.
	Glyph []byte
	// Login is how the user signs in to it.
	Login Login
	// HoldsSignedOut is set when a message does not go to it signed out
	// (Ready), and stays in the composer: it would only retry for long.
	// Otherwise it takes the message, and says it is signed out.
	HoldsSignedOut bool
}

// Login is how the user signs in to an Agent.
type Login int

const (
	// LoginNone: it needs no sign-in, or aibo cannot tell.
	LoginNone Login = iota
	// LoginTerminal: in the Agent's own flow, by running its executable
	// in a terminal; aibo does not stand in for it.
	LoginTerminal
	// LoginInApp: in aibo, through the Agent's own flow (StartLogin).
	LoginInApp
)

// Specs are the Agents aibo supports.
var Specs = []Spec{
	{Kind: claude.Kind, Name: "Claude Code", Command: "claude", MinVersion: "2.1.318", InstallURL: "https://code.claude.com/docs/en/setup",
		Glyph: []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#c96442"/><g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5.9 8.5l12.2 7"/><path d="M5.9 15.5l12.2-7"/></g></svg>`),
		Login: LoginTerminal},
	{Kind: codex.Kind, Name: "Codex", Command: "codex", MinVersion: "0.169.0", InstallURL: "https://github.com/openai/codex#installation",
		Glyph: []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2f2f33" stroke="#5a5a62" stroke-width="1"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l4 4-4 4"/><path d="M13 16h5"/></g></svg>`),
		Login: LoginInApp, HoldsSignedOut: true},
	{Kind: OpenCode, Name: "OpenCode", Command: "opencode", MinVersion: "1.19.6", InstallURL: "https://opencode.ai/docs/"},
}

// Describe returns what aibo knows of an Agent, if it supports it.
func Describe(kind agent.Kind) (Spec, bool) {
	for _, s := range Specs {
		if s.Kind == kind {
			return s, true
		}
	}
	return Spec{}, false
}

// State is how an Agent stands.
type State int

const (
	Checking State = iota
	NotInstalled
	TooOld
	// Broken: found, but its version or sign-in could not be read.
	Broken
	NotLoggedIn
	Ready
)

// Status is an Agent's standing, and the facts behind it.
type Status struct {
	Spec
	State State
	// Path is the executable found; Source how it was found.
	Path    string
	Source  Source
	Version string
	// Auth is how it is signed in, as it says.
	Auth string
	// Problem is why it is not ready, if it is not; Detail what the
	// system or the Agent said of it.
	Problem Problem
	Detail  string
}

// Source is how an Agent's executable was found.
type Source int

const (
	SourceNone Source = iota
	// SourceSettings: the user chose it in the settings.
	SourceSettings
	// SourceCommon: where executables are usually installed.
	SourceCommon
	// SourcePath: the login shell's PATH.
	SourcePath
)

// Problem is why an Agent is not ready, for the shell to word.
type Problem int

const (
	NoProblem Problem = iota
	// ProblemUnknown: aibo does not support the Agent.
	ProblemUnknown
	// ProblemBadPath: the executable the user chose (Detail) does not
	// exist or cannot run.
	ProblemBadPath
	// ProblemNotFound: no executable was found.
	ProblemNotFound
	// ProblemNoVersion, ProblemBadVersion: its version could not be read,
	// or was not understood.
	ProblemNoVersion
	ProblemBadVersion
	// ProblemTooOld: its version is older than Spec.MinVersion.
	ProblemTooOld
	// ProblemNoLogin, ProblemBadLogin: how it is signed in could not be
	// read, or was not understood.
	ProblemNoLogin
	ProblemBadLogin
	// ProblemSignedOut: it is signed out.
	ProblemSignedOut
)

// Usable reports whether sessions can start with the Agent: installed and
// new enough. (Signed out, it still starts: it says so itself.)
func (s Status) Usable() bool { return s.State == Ready || s.State == NotLoggedIn }

// Options configures a Registry. The zero value uses the platform defaults.
type Options struct {
	// Paths are the executables the user chose, by kind.
	Paths map[agent.Kind]string
	// Shell is the user's login shell; $SHELL when empty.
	Shell string
	// Home is the home directory; the user's when empty.
	Home string
	// Dirs are where executables are usually installed, before the login
	// shell's PATH is asked for; the usual ones when nil.
	Dirs []string
}

// Registry is the Agents and how they stand.
type Registry struct {
	configMu   sync.Mutex
	configPath string
	specs      []Spec
	acp        map[agent.Kind]*acp.Agent
	claude     *claude.Agent
	codex      *codex.Agent
	o          Options

	mu        sync.Mutex
	login     LoginState
	status    map[agent.Kind]*Status
	paths     map[agent.Kind]string
	shellPath string
	listeners []func()
}

// New returns the registry, every Agent still to check (Detect).
func New(o Options) *Registry {
	if o.Home == "" {
		o.Home, _ = os.UserHomeDir()
	}
	if o.Shell == "" && runtime.GOOS != "windows" {
		o.Shell = os.Getenv("SHELL")
		if o.Shell == "" {
			o.Shell = "/bin/zsh"
		}
	}
	if o.Dirs == nil && runtime.GOOS == "windows" {
		o.Dirs = []string{filepath.Join(o.Home, ".local", "bin"), filepath.Join(o.Home, ".opencode", "bin")}
	} else if o.Dirs == nil {
		o.Dirs = append([]string{filepath.Join(o.Home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", filepath.Join(o.Home, ".npm-global", "bin"), filepath.Join(o.Home, ".opencode", "bin")},
			globDirs(filepath.Join(o.Home, ".nvm", "versions", "node", "*", "bin"))...)
	}
	r := &Registry{claude: claude.New(""), codex: codex.New(""), o: o, status: map[agent.Kind]*Status{}, paths: map[agent.Kind]string{},
		specs: append([]Spec(nil), Specs...), acp: map[agent.Kind]*acp.Agent{OpenCode: acp.New(OpenCode, "OpenCode", "", []string{"acp"}, "aibo_")}}
	for k, p := range o.Paths {
		r.paths[k] = p
	}
	for _, s := range Specs {
		r.status[s.Kind] = &Status{Spec: s, State: Checking}
	}
	r.codex.OnAccount(r.accountChanged)
	return r
}

// ErrNoInAppLogin is StartLogin's error for an Agent signed in to
// otherwise (Spec.Login).
var ErrNoInAppLogin = errors.New("the Agent cannot sign in in aibo")

// LoginState is a sign-in started in aibo (LoginInApp).
type LoginState struct {
	codex.Login
	// Waiting is set until it ends; Error says why it failed, in the
	// Agent's words.
	Waiting bool
	Error   string
}

// StartLogin starts signing in to an Agent in aibo (LoginInApp), as
// Codex with ChatGPT: in the browser (open AuthURL), or with a device
// code (show UserCode and VerificationURL).
func (r *Registry) StartLogin(ctx context.Context, kind agent.Kind, deviceCode bool) (LoginState, error) {
	if kind != codex.Kind {
		return LoginState{}, ErrNoInAppLogin
	}
	l, err := r.codex.Login(ctx, deviceCode)
	if err != nil {
		r.mu.Lock()
		r.login = LoginState{Error: err.Error()}
		r.mu.Unlock()
		r.changed()
		return LoginState{}, err
	}
	st := LoginState{Login: l, Waiting: true}
	r.mu.Lock()
	r.login = st
	r.mu.Unlock()
	r.changed()
	return st, nil
}

// CancelLogin cancels the sign-in to an Agent started in aibo.
func (r *Registry) CancelLogin(ctx context.Context, kind agent.Kind) {
	if kind != codex.Kind {
		return
	}
	r.mu.Lock()
	id := r.login.ID
	r.login = LoginState{}
	r.mu.Unlock()
	if id != "" {
		r.codex.CancelLogin(ctx, id)
	}
	r.changed()
}

// AppLogin returns the sign-in to an Agent started in aibo, if any.
func (r *Registry) AppLogin(kind agent.Kind) LoginState {
	if kind != codex.Kind {
		return LoginState{}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.login
}

// accountChanged hears of Codex's account: a sign-in ended, or how it is
// signed in changed; either way it is checked again.
func (r *Registry) accountChanged(e codex.AccountEvent) {
	r.mu.Lock()
	if e.LoginID != "" && e.LoginID == r.login.ID {
		r.login.Waiting = false
		if !e.Success {
			r.login.Error = e.Error
		}
	}
	r.mu.Unlock()
	go r.Check(context.Background(), codex.Kind)
}

// SetPaths sets the executables the user chose, before Detect.
func (r *Registry) SetPaths(paths map[agent.Kind]string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for k, p := range paths {
		r.paths[k] = p
	}
}

func globDirs(pattern string) []string {
	m, _ := filepath.Glob(pattern)
	return m
}

// Agents are the adapters, for the workbench.
func (r *Registry) Agents() []agent.Agent {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []agent.Agent{r.claude, r.codex}
	for _, spec := range r.specs {
		if a := r.acp[spec.Kind]; a != nil {
			out = append(out, a)
		}
	}
	return out
}

// Codex is the Codex adapter, for signing in.
func (r *Registry) Codex() *codex.Agent { return r.codex }

// OnChange calls fn, from any goroutine, after an Agent's standing
// changes.
func (r *Registry) OnChange(fn func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listeners = append(r.listeners, fn)
}

func (r *Registry) changed() {
	r.mu.Lock()
	fns := append([]func(){}, r.listeners...)
	r.mu.Unlock()
	for _, fn := range fns {
		fn()
	}
}

// Status returns an Agent's standing.
func (r *Registry) Status(kind agent.Kind) Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.status[kind]; ok {
		return *s
	}
	return Status{Spec: Spec{Kind: kind, Name: string(kind)}, State: NotInstalled, Problem: ProblemUnknown}
}

// Statuses returns every Agent's standing, in Specs' order.
func (r *Registry) Statuses() []Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]Status, len(r.specs))
	for i, s := range r.specs {
		out[i] = *r.status[s.Kind]
	}
	return out
}

// Paths returns the executables the user chose.
func (r *Registry) Paths() map[agent.Kind]string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := map[agent.Kind]string{}
	for k, p := range r.paths {
		out[k] = p
	}
	return out
}

// SetPath chooses an Agent's executable (empty: find it again), and
// checks it.
func (r *Registry) SetPath(ctx context.Context, kind agent.Kind, path string) {
	r.mu.Lock()
	if path == "" {
		delete(r.paths, kind)
	} else {
		r.paths[kind] = path
	}
	r.mu.Unlock()
	r.Check(ctx, kind)
}

// UnusableError is Ready's error for an Agent not installed, too old,
// or whose version could not be read.
type UnusableError struct{ Status Status }

func (e *UnusableError) Error() string {
	return fmt.Sprintf("%s cannot be used (problem %d) %s", e.Status.Name, e.Status.Problem, e.Status.Detail)
}

// Ready says why a message cannot go to the Agent now, or nil. Signed
// out, it goes only to an Agent that says so (Spec.HoldsSignedOut).
func (r *Registry) Ready(kind agent.Kind) error {
	s := r.Status(kind)
	switch {
	case s.State == Checking:
		return nil // its own errors will tell
	case !s.Usable():
		return &UnusableError{s}
	case s.State == NotLoggedIn:
		if s.HoldsSignedOut {
			return ErrNotLoggedIn
		}
	}
	return nil
}

// ErrNotLoggedIn is Ready's error for an Agent signed out.
var ErrNotLoggedIn = errors.New("the Agent is signed out")

// MarkNotLoggedIn records that a session found the Agent signed out.
func (r *Registry) MarkNotLoggedIn(kind agent.Kind) {
	r.mu.Lock()
	s, ok := r.status[kind]
	if ok && s.State == Ready {
		s.State, s.Problem, s.Auth = NotLoggedIn, ProblemSignedOut, ""
	}
	r.mu.Unlock()
	if ok {
		r.changed()
	}
}

// Detect finds and checks every Agent, the login shell's PATH first.
func (r *Registry) Detect(ctx context.Context) {
	var p string
	if runtime.GOOS != "windows" {
		p, _ = ShellPath(ctx, r.o.Shell)
	}
	r.mu.Lock()
	r.shellPath = p
	r.mu.Unlock()
	var wg sync.WaitGroup
	for _, s := range r.Statuses() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.Check(ctx, s.Kind)
		}()
	}
	wg.Wait()
}

// env is the environment of an Agent's processes: the login shell's PATH,
// which a Mac app launched from the Dock lacks, before its own.
func (r *Registry) env() []string {
	r.mu.Lock()
	sp := r.shellPath
	r.mu.Unlock()
	path := os.Getenv("PATH")
	if sp != "" {
		path = sp + string(os.PathListSeparator) + path
	}
	return []string{"PATH=" + path}
}

// Check finds and checks one Agent again.
func (r *Registry) Check(ctx context.Context, kind agent.Kind) {
	known := r.Status(kind)
	if known.Problem == ProblemUnknown {
		return
	}
	spec := known.Spec
	r.set(Status{Spec: spec, State: Checking})
	st := r.check(ctx, spec)
	env := r.env()
	if st.Usable() {
		switch kind {
		case claude.Kind:
			r.claude.Configure(st.Path, env)
		case codex.Kind:
			r.codex.Configure(st.Path, env)
		default:
			r.mu.Lock()
			a := r.acp[kind]
			r.mu.Unlock()
			a.Configure(st.Path, env)
			if kind == OpenCode {
				prefix := "aibo_"
				if !older(st.Version, "2.0.0") {
					prefix = "aibo."
				}
				a.SetToolPrefix(prefix)
			}
		}
	}
	r.set(st)
}

func (r *Registry) set(s Status) {
	r.mu.Lock()
	r.status[s.Kind] = &s
	r.mu.Unlock()
	r.changed()
}

func (r *Registry) check(ctx context.Context, spec Spec) Status {
	st := Status{Spec: spec}
	r.mu.Lock()
	chosen, shellPath := r.paths[spec.Kind], r.shellPath
	r.mu.Unlock()
	if runtime.GOOS == "windows" {
		shellPath = os.Getenv("PATH")
	}
	switch {
	case chosen == "" && filepath.IsAbs(spec.Command):
		if !executable(spec.Command) {
			st.State, st.Problem, st.Detail = NotInstalled, ProblemBadPath, spec.Command
			return st
		}
		st.Path, st.Source = spec.Command, SourceSettings
	case chosen != "":
		if !executable(chosen) {
			st.State, st.Problem, st.Detail = NotInstalled, ProblemBadPath, chosen
			return st
		}
		st.Path, st.Source = chosen, SourceSettings
	default:
		if p, ok := findIn(spec.Command, r.o.Dirs); ok {
			st.Path, st.Source = p, SourceCommon
		} else if p, ok := findIn(spec.Command, filepath.SplitList(shellPath)); ok {
			st.Path, st.Source = p, SourcePath
		} else {
			st.State, st.Problem = NotInstalled, ProblemNotFound
			return st
		}
	}
	if real, err := filepath.EvalSymlinks(st.Path); err == nil {
		st.Path = real
	}
	if spec.MinVersion == "" {
		st.State = Ready // Configured executables need only implement ACP.
		return st
	}
	env := r.env()
	out, _, err := run(ctx, st.Path, env, "--version")
	if err != nil {
		st.State, st.Problem, st.Detail = Broken, ProblemNoVersion, err.Error()
		return st
	}
	st.Version = versionRE.FindString(out)
	if st.Version == "" {
		st.State, st.Problem, st.Detail = Broken, ProblemBadVersion, strings.TrimSpace(out)
		return st
	}
	if older(st.Version, spec.MinVersion) {
		st.State, st.Problem = TooOld, ProblemTooOld
		return st
	}
	switch spec.Kind {
	case claude.Kind:
		st.State, st.Auth, st.Problem, st.Detail = claudeLogin(ctx, st.Path, env)
	case codex.Kind:
		st.State, st.Auth, st.Problem, st.Detail = codexLogin(ctx, st.Path, env)
	default:
		st.State = Ready
	}
	return st
}

// claudeLogin asks Claude Code how it is signed in (claude auth status:
// JSON, exit 1 when not).
func claudeLogin(ctx context.Context, path string, env []string) (State, string, Problem, string) {
	out, code, err := run(ctx, path, env, "auth", "status")
	var s struct {
		LoggedIn         bool   `json:"loggedIn"`
		AuthMethod       string `json:"authMethod"`
		SubscriptionType string `json:"subscriptionType"`
	}
	if json.Unmarshal([]byte(out), &s) != nil {
		if err != nil {
			return Broken, "", ProblemNoLogin, err.Error()
		}
		return Broken, "", ProblemBadLogin, strings.TrimSpace(out)
	}
	if !s.LoggedIn || code == 1 {
		return NotLoggedIn, "", ProblemSignedOut, ""
	}
	auth := s.AuthMethod
	if s.SubscriptionType != "" {
		auth += " (" + s.SubscriptionType + ")"
	}
	return Ready, auth, NoProblem, ""
}

// codexLogin asks Codex how it is signed in (codex login status: exit 1
// when not).
func codexLogin(ctx context.Context, path string, env []string) (State, string, Problem, string) {
	// It says so on stderr.
	out, code, err := runOut(ctx, true, path, env, "login", "status")
	text := strings.TrimSpace(out)
	switch {
	case code == 1:
		return NotLoggedIn, "", ProblemSignedOut, ""
	case err != nil:
		return Broken, "", ProblemNoLogin, err.Error()
	}
	return Ready, strings.TrimPrefix(text, "Logged in using "), NoProblem, ""
}

var versionRE = regexp.MustCompile(`\d+\.\d+\.\d+`)

// older reports whether version a is older than b.
func older(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := range 3 {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			return x < y
		}
	}
	return false
}

func executable(p string) bool {
	fi, err := os.Stat(p)
	if err != nil || !fi.Mode().IsRegular() {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(filepath.Ext(p), ".exe")
	}
	return fi.Mode()&0o111 != 0
}

func findIn(name string, dirs []string) (string, bool) {
	for _, d := range dirs {
		if d == "" {
			continue
		}
		p := filepath.Join(d, name)
		if runtime.GOOS == "windows" {
			if !filepath.IsAbs(d) {
				continue
			}
			if !strings.EqualFold(filepath.Ext(p), ".exe") {
				p += ".exe"
			}
		}
		if executable(p) {
			return p, true
		}
		if runtime.GOOS == "windows" && name == "codex" {
			if p := npmCodex(d); p != "" {
				return p, true
			}
		}
	}
	return "", false
}

// npm's Windows launcher wraps a native executable shipped in its platform package.
func npmCodex(dir string) string {
	if _, err := os.Stat(filepath.Join(dir, "codex.cmd")); err != nil {
		return ""
	}
	arch, triple := "x64", "x86_64-pc-windows-msvc"
	if runtime.GOARCH == "arm64" {
		arch, triple = "arm64", "aarch64-pc-windows-msvc"
	}
	root := filepath.Join(dir, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-"+arch, "vendor", triple)
	for _, sub := range []string{"bin", "codex"} {
		if p := filepath.Join(root, sub, "codex.exe"); executable(p) {
			return p
		}
	}
	return ""
}

// checkTimeout bounds each check an Agent's executable runs.
const checkTimeout = 15 * time.Second

// run runs an Agent's executable for a check, returning its output and
// exit code; err is set when it could not run, or failed otherwise than
// by exiting with a code.
func run(ctx context.Context, path string, env []string, args ...string) (string, int, error) {
	return runOut(ctx, false, path, env, args...)
}

// runOut is run, with stderr in the output too when combined.
func runOut(ctx context.Context, combined bool, path string, env []string, args ...string) (string, int, error) {
	ctx, cancel := context.WithTimeout(ctx, checkTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = append(os.Environ(), env...)
	agent.BoundProcess(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	if combined {
		cmd.Stderr = &out
	}
	err := cmd.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return out.String(), exit.ExitCode(), nil
	}
	return out.String(), 0, err
}

// shellTimeout bounds asking the login shell for its PATH: the user's rc
// files may be slow, or wait for input.
const shellTimeout = 3 * time.Second

const marker = "__AIBO_PATH__"

// ShellPath asks the user's login shell, interactive as the user's own
// terminal is, for its PATH: what the rc files add, which an app launched
// from the Dock does not get.
func ShellPath(ctx context.Context, shell string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, shellTimeout)
	defer cancel()
	script := `printf '` + marker + `%s` + marker + `' "$PATH"`
	if filepath.Base(shell) == "fish" {
		script = `printf '` + marker + `%s` + marker + `' (string join : $PATH)`
	}
	cmd := exec.CommandContext(ctx, shell, "-lic", script)
	cmd.Stdin = nil // /dev/null: nothing to wait for
	agent.BoundProcess(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil && out.Len() == 0 {
		return "", err
	}
	s := out.String()
	i := strings.Index(s, marker)
	j := strings.LastIndex(s, marker)
	if i < 0 || j <= i {
		return "", errors.New("the login shell gave no PATH")
	}
	return s[i+len(marker) : j], nil
}
