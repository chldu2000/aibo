package shell_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/agent/fake"
	"github.com/chldu2000/aibo/internal/shell"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

func testPNG(t *testing.T, c color.RGBA) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 40, 30))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = c.R, c.G, c.B, 255
	}
	var buf bytes.Buffer
	png.Encode(&buf, img)
	return buf.Bytes()
}

// Images pasted or dropped on the composer are attached, files of the
// workspace dropped on it mentioned; text still pastes as text.
func TestAttachImages(t *testing.T) {
	var mu sync.Mutex
	var got []agent.Turn
	respond := func(ctx context.Context, _ agent.StartOptions, turn agent.Turn, emit func(agent.Event)) {
		mu.Lock()
		got = append(got, turn)
		mu.Unlock()
	}
	wb, err := workbench.Open(workbench.Options{DataDir: t.TempDir(), Agents: []agent.Agent{fake.New(respond)}})
	if err != nil {
		t.Fatal(err)
	}
	defer wb.Close()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "notes.md"), []byte("# x"), 0o644)
	outside := t.TempDir()
	shot := filepath.Join(outside, "shot.png")
	os.WriteFile(shot, testPNG(t, color.RGBA{20, 40, 220, 255}), 0o644)
	os.WriteFile(filepath.Join(outside, "a.pdf"), []byte("%PDF-1.7"), 0o644)
	ws, _ := wb.AddWorkspace(root)
	wb.NewSession(ws.ID, fake.Kind, "")
	var opened []string
	tt := ui.NewTester(shell.New(wb, shell.Options{OpenFile: func(p string) { opened = append(opened, p) }}).View, 1100, 800)
	frame := func() {
		for i := 0; i < 3; i++ {
			tt.Frame()
			tt.Advance(time.Second)
			time.Sleep(5 * time.Millisecond) // images are kept off the main thread
		}
	}
	until := func(s string) ui.Rect {
		t.Helper()
		for i := 0; i < 100; i++ {
			if r, ok := tt.Find(s); ok {
				return r
			}
			frame()
		}
		t.Fatalf("never %q: %q", s, tt.Texts())
		return ui.Rect{}
	}
	paste := func(d transfer.Data) {
		tt.SetClipboardData(d)
		tt.Key(ui.Cmd, ui.KeyV)
		frame()
	}
	frame()
	if err := tt.Click("给 假 Agent 发消息"); err != nil {
		t.Fatal(err)
	}
	frame()

	paste(transfer.TextData("看图")) // text pastes as text: the Agent gets it
	red := testPNG(t, color.RGBA{220, 20, 20, 255})
	paste(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, red))))
	until("移除图片 image.png")
	paste(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, red))))
	until("移除图片 image 2.png")
	if err := tt.Click("移除图片 image 2.png"); err != nil {
		t.Fatal(err)
	}
	frame()
	if _, ok := tt.Find("移除图片 image 2.png"); ok {
		t.Error("the image stayed")
	}

	composer := until("给 假 Agent 发消息")
	if !tt.DropFiles(composer.X+20, composer.Y+10, shot, filepath.Join(root, "notes.md")) {
		t.Fatal("the composer did not take the files")
	}
	until("移除图片 shot.png")
	until("移除文件 notes.md")
	tt.DropFiles(composer.X+20, composer.Y+10, filepath.Join(outside, "a.pdf"))
	for i := 0; i < 100 && !hasTextLike(tt, "不能添加或引用"); i++ {
		frame()
	}
	if !hasTextLike(tt, "a.pdf 不是图片") {
		t.Errorf("no notice for a PDF: %q", tt.Texts())
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		saveImage(t, tt.Image(), filepath.Join(p, "17-draft.png"))
	}

	if err := tt.Click("给 假 Agent 发消息"); err != nil {
		t.Fatal(err)
	}
	tt.Key(0, ui.KeyEnter)
	for i := 0; i < 100; i++ {
		mu.Lock()
		n := len(got)
		mu.Unlock()
		if n > 0 {
			break
		}
		frame()
	}
	mu.Lock()
	turn := got
	mu.Unlock()
	if len(turn) != 1 || turn[0].Text != "看图" || len(turn[0].Images) != 2 || len(turn[0].Files) != 1 {
		t.Fatalf("the Agent got %+v", turn)
	}
	frame()
	if _, ok := tt.Find("移除图片 image.png"); ok {
		t.Error("the chip stayed in the composer")
	}
	if err := tt.Click("打开图片 shot.png"); err != nil {
		t.Fatalf("%v: %q", err, tt.Texts())
	}
	if len(opened) != 1 || opened[0] != turn[0].Images[1].Path {
		t.Errorf("opened %q", opened)
	}
	if p := os.Getenv("AIBO_SCREENSHOT"); p != "" {
		frame()
		saveImage(t, tt.Image(), filepath.Join(p, "17-sent.png"))
	}
}

func hasTextLike(tt *ui.Tester, s string) bool {
	for _, x := range tt.Texts() {
		if strings.Contains(x, s) {
			return true
		}
	}
	return false
}
