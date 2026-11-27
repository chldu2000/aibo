package archtest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// consoleExempt lists the functions, as file:function, that may start a
// program without hiding its console, with why.
var consoleExempt = map[string]string{
	// Runs only on macOS: Windows opens the terminal through the shell.
	"cmd/aibo/main.go:openTerminal": "macOS only",
}

// TestProgramsHideConsole checks that every function starting a program
// hides its console window: on Windows a GUI app's console programs each
// open one otherwise (see internal/proc).
func TestProgramsHideConsole(t *testing.T) {
	for _, dir := range []string{"../../cmd", "../../internal"} {
		err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
			if err != nil {
				return err
			}
			rel := strings.TrimPrefix(filepath.ToSlash(path), "../../")
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Body == nil {
					continue
				}
				starts, hides := false, false
				ast.Inspect(fn.Body, func(n ast.Node) bool {
					call, ok := n.(*ast.CallExpr)
					if !ok {
						return true
					}
					switch callee(call.Fun) {
					case "exec.Command", "exec.CommandContext":
						starts = true
					case "proc.Hide", "agent.BoundProcess", "BoundProcess":
						hides = true
					}
					return true
				})
				key := rel + ":" + fn.Name.Name
				if starts && !hides && consoleExempt[key] == "" {
					t.Errorf("%s starts a program without proc.Hide or agent.BoundProcess: on Windows it opens a console window", key)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

// callee names a call's function as pkg.Name or Name.
func callee(fun ast.Expr) string {
	switch f := fun.(type) {
	case *ast.Ident:
		return f.Name
	case *ast.SelectorExpr:
		if x, ok := f.X.(*ast.Ident); ok {
			return x.Name + "." + f.Sel.Name
		}
	}
	return ""
}
