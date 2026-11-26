package shell_test

import (
	"os"
	"strings"
	"testing"

	"github.com/chldu2000/aibo/internal/agents/testdata/fakecli"
	"github.com/egoist/mygo/i18n"
)

// locale is the language the shell's tests see: Simplified Chinese, whose
// labels they find elements by, unless a test says otherwise (inLocale).
var locale = "zh-Hans"

func TestMain(m *testing.M) {
	fakecli.RunIfCLI()
	// Tests register this binary as an ACP Agent's command. Launched as
	// one, by a session or by the probe for its lists, it is no Agent: it
	// ends at once rather than run the tests.
	for _, arg := range os.Args[1:] {
		if !strings.HasPrefix(arg, "-test.") {
			os.Exit(2)
		}
	}
	i18n.SetLocaleFunc(func() string { return locale })
	os.Exit(m.Run())
}

// inLocale runs the rest of the test in another language.
func inLocale(t *testing.T, tag string) {
	before := locale
	locale = tag
	t.Cleanup(func() { locale = before })
}
