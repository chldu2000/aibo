package shell_test

import (
	"os"
	"testing"

	"github.com/chldu2000/aibo/internal/agents/testdata/fakecli"
	"github.com/egoist/mygo/i18n"
)

// locale is the language the shell's tests see: Simplified Chinese, whose
// labels they find elements by, unless a test says otherwise (inLocale).
var locale = "zh-Hans"

func TestMain(m *testing.M) {
	fakecli.RunIfCLI()
	i18n.SetLocaleFunc(func() string { return locale })
	os.Exit(m.Run())
}

// inLocale runs the rest of the test in another language.
func inLocale(t *testing.T, tag string) {
	before := locale
	locale = tag
	t.Cleanup(func() { locale = before })
}
