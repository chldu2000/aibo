// Package agents finds the Agents installed on this Mac, checks that
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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
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
	Path, Source string
	Version      string
	// Auth is how it is signed in, as it says.
	Auth string
	// Reason says, for the user, why it is not ready.
	Reason string
}

// Usable reports whether sessions can start with the Agent: installed and
// new enough. (Signed out, it still starts: it says so itself.)
func (s Status) Usable() bool { return s.State == Ready || s.State == NotLoggedIn }

// Options configures a Registry. The zero value looks where a Mac keeps
// things.
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
	claude *claude.Agent
	codex  *codex.Agent
	o      Options

	mu        sync.Mutex
	login     LoginState
	status    map[agent.Kind]*Status
	paths     map[agent.Kind]string
	shellPath string
	listeners []func()
}

// New returns the registry, every Agent still to check (Detect).
func New(o Options) *Registry {
	if o.Shell == "" {
		o.Shell = os.Getenv("SHELL")
	}
	if o.Shell == "" {
		o.Shell = "/bin/zsh"
	}
	if o.Home == "" {
		o.Home, _ = os.UserHomeDir()
	}
	if o.Dirs == nil {
		o.Dirs = append([]string{filepath.Join(o.Home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", filepath.Join(o.Home, ".npm-global", "bin")},
			globDirs(filepath.Join(o.Home, ".nvm", "versions", "node", "*", "bin"))...)
	}
	r := &Registry{claude: claude.New(""), codex: codex.New(""), o: o, status: map[agent.Kind]*Status{}, paths: map[agent.Kind]string{}}
	for k, p := range o.Paths {
		r.paths[k] = p
	}
	for _, s := range Specs {
		r.status[s.Kind] = &Status{Spec: s, State: Checking, Reason: "正在检测……"}
	}
	r.codex.OnAccount(r.accountChanged)
	return r
}

// ErrNoInAppLogin is StartLogin's error for an Agent signed in to
// otherwise (Spec.Login).
var ErrNoInAppLogin = errors.New("这个 Agent 不能在 aibo 里登录")

// LoginState is a sign-in started in aibo (LoginInApp).
type LoginState struct {
	codex.Login
	// Waiting is set until it ends; Error says why it failed.
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
			r.login.Error = "登录没有完成：" + e.Error
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
func (r *Registry) Agents() []agent.Agent { return []agent.Agent{r.claude, r.codex} }

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
	return Status{Spec: Spec{Kind: kind, Name: string(kind)}, State: NotInstalled, Reason: "aibo 不认识这个 Agent"}
}

// Statuses returns every Agent's standing, in Specs' order.
func (r *Registry) Statuses() []Status {
	out := make([]Status, len(Specs))
	for i, s := range Specs {
		out[i] = r.Status(s.Kind)
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

// Ready says why a message cannot go to the Agent now, or nil. Signed
// out, it goes only to an Agent that says so (Spec.HoldsSignedOut).
func (r *Registry) Ready(kind agent.Kind) error {
	s := r.Status(kind)
	switch {
	case s.State == Checking:
		return nil // its own errors will tell
	case !s.Usable():
		return errors.New(s.Reason)
	case s.State == NotLoggedIn:
		if spec, _ := Describe(kind); spec.HoldsSignedOut {
			return ErrNotLoggedIn
		}
	}
	return nil
}

// ErrNotLoggedIn is Ready's error for an Agent signed out.
var ErrNotLoggedIn = errors.New("Agent 未登录")

// MarkNotLoggedIn records that a session found the Agent signed out.
func (r *Registry) MarkNotLoggedIn(kind agent.Kind) {
	r.mu.Lock()
	s, ok := r.status[kind]
	if ok && s.State == Ready {
		s.State, s.Reason, s.Auth = NotLoggedIn, s.Name+" 未登录", ""
	}
	r.mu.Unlock()
	if ok {
		r.changed()
	}
}

// Detect finds and checks every Agent, the login shell's PATH first.
func (r *Registry) Detect(ctx context.Context) {
	p, _ := ShellPath(ctx, r.o.Shell)
	r.mu.Lock()
	r.shellPath = p
	r.mu.Unlock()
	var wg sync.WaitGroup
	for _, s := range Specs {
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
	var spec Spec
	for _, s := range Specs {
		if s.Kind == kind {
			spec = s
		}
	}
	r.set(Status{Spec: spec, State: Checking, Reason: "正在检测……"})
	st := r.check(ctx, spec)
	env := r.env()
	if st.Usable() {
		switch kind {
		case claude.Kind:
			r.claude.Configure(st.Path, env)
		case codex.Kind:
			r.codex.Configure(st.Path, env)
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
	switch {
	case chosen != "":
		if !executable(chosen) {
			st.State, st.Reason = NotInstalled, "指定的可执行文件不存在或不能执行："+chosen
			return st
		}
		st.Path, st.Source = chosen, "设置中指定"
	default:
		if p, ok := findIn(spec.Command, r.o.Dirs); ok {
			st.Path, st.Source = p, "常见安装位置"
		} else if p, ok := findIn(spec.Command, filepath.SplitList(shellPath)); ok {
			st.Path, st.Source = p, "登录 shell 的 PATH"
		} else {
			st.State, st.Reason = NotInstalled, "没有找到 "+spec.Name+"。请按官方说明安装，或在设置里指定可执行文件。"
			return st
		}
	}
	if real, err := filepath.EvalSymlinks(st.Path); err == nil {
		st.Path = real
	}
	env := r.env()
	out, _, err := run(ctx, st.Path, env, "--version")
	if err != nil {
		st.State, st.Reason = Broken, "无法读取版本："+err.Error()
		return st
	}
	st.Version = versionRE.FindString(out)
	if st.Version == "" {
		st.State, st.Reason = Broken, "无法识别版本："+strings.TrimSpace(out)
		return st
	}
	if older(st.Version, spec.MinVersion) {
		st.State, st.Reason = TooOld, fmt.Sprintf("版本 %s 过低，请升级到 %s 或更高版本。", st.Version, spec.MinVersion)
		return st
	}
	switch spec.Kind {
	case claude.Kind:
		st.State, st.Auth, st.Reason = claudeLogin(ctx, st.Path, env)
	case codex.Kind:
		st.State, st.Auth, st.Reason = codexLogin(ctx, st.Path, env)
	}
	return st
}

// claudeLogin asks Claude Code how it is signed in (claude auth status:
// JSON, exit 1 when not).
func claudeLogin(ctx context.Context, path string, env []string) (State, string, string) {
	out, code, err := run(ctx, path, env, "auth", "status")
	var s struct {
		LoggedIn         bool   `json:"loggedIn"`
		AuthMethod       string `json:"authMethod"`
		SubscriptionType string `json:"subscriptionType"`
	}
	if json.Unmarshal([]byte(out), &s) != nil {
		if err != nil {
			return Broken, "", "无法读取登录状态：" + err.Error()
		}
		return Broken, "", "无法识别登录状态：" + strings.TrimSpace(out)
	}
	if !s.LoggedIn || code == 1 {
		return NotLoggedIn, "", "Claude Code 未登录"
	}
	auth := s.AuthMethod
	if s.SubscriptionType != "" {
		auth += "（" + s.SubscriptionType + "）"
	}
	return Ready, auth, ""
}

// codexLogin asks Codex how it is signed in (codex login status: exit 1
// when not).
func codexLogin(ctx context.Context, path string, env []string) (State, string, string) {
	// It says so on stderr.
	out, code, err := runOut(ctx, true, path, env, "login", "status")
	text := strings.TrimSpace(out)
	switch {
	case code == 1:
		return NotLoggedIn, "", "Codex 未登录"
	case err != nil:
		return Broken, "", "无法读取登录状态：" + err.Error()
	}
	return Ready, strings.TrimPrefix(text, "Logged in using "), ""
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
	return err == nil && !fi.IsDir() && fi.Mode()&0o111 != 0
}

func findIn(name string, dirs []string) (string, bool) {
	for _, d := range dirs {
		if d == "" {
			continue
		}
		if p := filepath.Join(d, name); executable(p) {
			return p, true
		}
	}
	return "", false
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
	bounded(cmd)
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
	bounded(cmd)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil && out.Len() == 0 {
		return "", err
	}
	s := out.String()
	i := strings.Index(s, marker)
	j := strings.LastIndex(s, marker)
	if i < 0 || j <= i {
		return "", errors.New("登录 shell 没有给出 PATH")
	}
	return s[i+len(marker) : j], nil
}
