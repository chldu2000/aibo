package shell

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chldu2000/aibo/internal/model"
	"github.com/chldu2000/aibo/internal/workbench"
	"github.com/chldu2000/aibo/locales"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
)

// Images and files the user gives the composer, pasted, dropped on it or
// chosen with its paperclip: images are attached (ADR 0006), other files
// mentioned (ADR 0004).

// thumb is an attachment's picture as shown, decoded off the main thread.
type thumb struct {
	bm     *ui.Bitmap
	failed bool
}

// thumbSide is the longer side thumbnails are decoded at, in pixels:
// enough for the messages' pictures on a Retina screen.
const thumbSide = 480

// pasteFiles takes a paste of something other than text into a session's
// draft: files copied in Finder, or an image. It reports whether it took
// it; text pastes as usual.
func (s *Shell) pasteFiles(svc ui.Services, id, text string) bool {
	if files, err := svc.ReadClipboardData(transfer.FileList, transfer.URIList).Files(); err == nil && len(files) > 0 {
		s.givePaths(id, files)
		return true
	}
	if text != "" {
		return false
	}
	b, err := svc.ReadClipboardData(transfer.PNG).Read(transfer.PNG)
	if err != nil || len(b) == 0 {
		return false
	}
	v := s.view(id)
	v.attaching++
	go func() {
		a, err := s.wb.AttachImage(id, "", b)
		s.later(func() {
			v.attaching--
			if err != nil {
				s.notice = s.say(err)
				return
			}
			v.addAttachment(a)
		})
	}()
	return true
}

// givePaths gives a session's draft files by their paths: images are
// attached, others mentioned when the session may read them.
func (s *Shell) givePaths(id string, paths []string) {
	if len(paths) == 0 {
		return
	}
	v := s.view(id)
	v.attaching++
	go func() {
		var given []workbench.Given
		var problems []string
		for _, p := range paths {
			g, err := s.wb.AttachPath(id, p)
			switch {
			case errors.Is(err, workbench.ErrNotReadable):
				problems = append(problems, locales.CannotAttach(filepath.Base(p)))
			case err != nil:
				problems = append(problems, fmt.Sprintf("%s: %s", filepath.Base(p), s.say(err)))
			default:
				given = append(given, g)
			}
		}
		s.later(func() {
			v.attaching--
			for _, g := range given {
				if g.Attachment != nil {
					v.addAttachment(*g.Attachment)
				} else if g.Mention != nil && !v.mentioning(g.Mention.Mention.Path) {
					v.mentions = append(v.mentions, g.Mention.Mention)
				}
			}
			if len(problems) > 0 {
				s.notice = strings.Join(problems, "\n")
			}
		})
	}()
}

// chooseImages asks for images to attach to a session's draft.
func (s *Shell) chooseImages(id string) {
	if s.opts.ChooseImages == nil {
		return
	}
	go func() {
		paths, ok := s.opts.ChooseImages()
		if !ok {
			return
		}
		s.later(func() { s.givePaths(id, paths) })
	}()
}

// addAttachment adds an attachment to the draft, under a name no other of
// the draft's has, as a second pasted "image.png".
func (v *sessionView) addAttachment(a model.Attachment) {
	base, ext := strings.TrimSuffix(a.Name, filepath.Ext(a.Name)), filepath.Ext(a.Name)
	for n := 2; v.attachmentNamed(a.Name); n++ {
		a.Name = fmt.Sprintf("%s %d%s", base, n, ext)
	}
	v.attachments = append(v.attachments, a)
}

func (v *sessionView) attachmentNamed(name string) bool {
	for _, x := range v.attachments {
		if x.Name == name {
			return true
		}
	}
	return false
}

// mentioning reports whether the draft mentions path already.
func (v *sessionView) mentioning(path string) bool {
	for _, m := range v.mentions {
		if m.Path == path {
			return true
		}
	}
	return false
}

// removeAttachment takes the draft's i-th attachment back, and its copy.
func (s *Shell) removeAttachment(v *sessionView, i int) {
	a := v.attachments[i]
	v.attachments = append(v.attachments[:i:i], v.attachments[i+1:]...)
	go s.wb.DiscardAttachment(a)
}

// thumb is an attachment's picture, nil until decoded or when it cannot
// be.
func (s *Shell) thumb(a model.Attachment) *ui.Bitmap {
	if t, ok := s.thumbs[a.File]; ok {
		return t.bm
	}
	if s.thumbs == nil {
		s.thumbs = map[string]*thumb{}
	}
	t := &thumb{}
	s.thumbs[a.File] = t
	path := s.wb.AttachmentPath(a)
	go func() {
		var bm *ui.Bitmap
		data, err := os.ReadFile(path)
		if err == nil {
			bm, err = ui.DecodeBitmapScaled(data, thumbSide)
		}
		s.later(func() { t.bm, t.failed = bm, err != nil })
	}()
	return nil
}

// draftAttachments are the chips of the images the draft carries, and one
// for those still being added.
func (s *Shell) draftAttachments(c *ui.Context, v *sessionView) {
	t := c.Theme()
	for i, a := range v.attachments {
		ui.Row(c).Key("a"+a.File).Gap(6).Padding(3, 4, 3, 3).Radius(8).AlignItems(ui.Center).BorderWidth(1).BorderColor(t.Border).Tooltip(a.Name).Children(func() {
			s.picture(c, a, 24, 24)
			ui.Text(c, a.Name).FontSize(12).TextColor(t.Text).MaxLines(1).TruncateMiddle().MaxWidth(200)
			if iconButton(c, "xmark", locales.RemoveImage(a.Name)).Clicked() {
				s.removeAttachment(v, i)
			}
		})
	}
	if v.attaching > 0 {
		ui.Row(c).Key("attaching").Gap(6).Padding(3, 8).Radius(8).AlignItems(ui.Center).BorderWidth(1).BorderColor(t.Border).Children(func() {
			icon(c, "photo").Size(12).Color(t.TextMuted)
			ui.Text(c, locales.Attaching()).FontSize(12).TextColor(t.TextMuted)
		})
	}
}

// sentAttachments are the pictures a sent message carried; one opens in
// the system's viewer.
func (s *Shell) sentAttachments(c *ui.Context, m model.Message) {
	ui.Row(c).Gap(6).Wrap().Children(func() {
		for _, a := range m.Attachments {
			w, h := pictureSize(a, 160)
			b := ui.Box(c).Key("a" + a.File).Radius(8).Clip().Tooltip(a.Name).Label(locales.OpenImage(a.Name)).Children(func() {
				s.picture(c, a, w, h)
			})
			if s.opts.OpenFile != nil {
				b.Cursor(ui.CursorPointer)
				if b.Clicked() {
					if p := s.wb.AttachmentPath(a); p != "" {
						s.opts.OpenFile(p)
					}
				}
			}
		}
	})
}

// picture shows an attachment w×h, a placeholder until it is decoded or
// when it cannot be.
func (s *Shell) picture(c *ui.Context, a model.Attachment, w, h float32) {
	t := c.Theme()
	if bm := s.thumb(a); bm != nil {
		ui.Image(c, bm).Width(w).Height(h).Fit(ui.Cover).Radius(5)
		return
	}
	ui.Box(c).Width(w).Height(h).Radius(5).Background(t.Surface).Center().Children(func() {
		icon(c, "photo").Size(min(w, h) / 2).Color(t.TextMuted)
	})
}

// pictureSize is the size an attachment shows at in a message, its
// longer side at most side DIPs.
func pictureSize(a model.Attachment, side float32) (float32, float32) {
	w, h := float32(a.Width), float32(a.Height)
	if w <= 0 || h <= 0 {
		return side, side
	}
	scale := min(side/max(w, h), 1)
	return max(w*scale, 24), max(h*scale, 24)
}
