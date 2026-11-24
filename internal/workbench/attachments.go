package workbench

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/chldu2000/aibo/internal/agent"
	"github.com/chldu2000/aibo/internal/images"
	"github.com/chldu2000/aibo/internal/model"
)

// Errors of attaching images, which the shell words for the user.
var (
	ErrNotImage      = errors.New("not a PNG, JPEG, GIF or WebP image")
	ErrImageTooLarge = errors.New("the image is too large")
	// ErrAttachmentGone: an attachment to send is not the session's, or
	// its file is gone.
	ErrAttachmentGone = errors.New("the attached image is gone")
)

// AttachImage keeps an image for a session's next message (ADR 0006): a
// copy in the data directory, shrunk when too large for the Agents. name
// is the file's name as the user knew it, "" for a pasted image. It
// decodes the image when it must shrink it: call it off the main thread.
// Until sent, the attachment is the caller's, which DiscardAttachment
// removes.
func (w *Workbench) AttachImage(sessionID, name string, data []byte) (model.Attachment, error) {
	w.mu.Lock()
	_, ok := w.sessions[sessionID]
	w.mu.Unlock()
	if !ok {
		return model.Attachment{}, ErrNoSuchSession
	}
	img, err := images.Ready(data)
	switch {
	case errors.Is(err, images.ErrUnsupported):
		return model.Attachment{}, ErrNotImage
	case errors.Is(err, images.ErrTooLarge):
		return model.Attachment{}, ErrImageTooLarge
	case err != nil:
		return model.Attachment{}, err
	}
	file, err := w.st.PutAttachment(sessionID, img.Ext, img.Data)
	if err != nil {
		return model.Attachment{}, err
	}
	return model.Attachment{Name: attachmentName(name, img.Ext), File: file, MIME: img.MIME, Width: img.Width, Height: img.Height, Size: int64(len(img.Data))}, nil
}

// Given is what a file the user gave the composer became: an attachment,
// for an image, or a mention.
type Given struct {
	Attachment *model.Attachment
	Mention    *FileHit
}

// AttachPath gives a session's next message a file the user pasted,
// dropped or chose: an image is attached (AttachImage), anything else
// mentioned (MentionPath), which only a file the session may read can be
// (ErrNotReadable). Not on the main thread.
func (w *Workbench) AttachPath(sessionID, path string) (Given, error) {
	if image, err := isImageFile(path); err != nil {
		return Given{}, err
	} else if !image {
		h, err := w.MentionPath(sessionID, path)
		if err != nil {
			return Given{}, err
		}
		return Given{Mention: &h}, nil
	}
	fi, err := os.Stat(path)
	if err != nil {
		return Given{}, err
	}
	if fi.Size() > images.MaxInput {
		return Given{}, ErrImageTooLarge
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Given{}, err
	}
	a, err := w.AttachImage(sessionID, filepath.Base(path), data)
	if err != nil {
		return Given{}, err
	}
	return Given{Attachment: &a}, nil
}

// isImageFile reports whether path is a file that starts as an image.
func isImageFile(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	if fi, err := f.Stat(); err != nil || fi.IsDir() {
		return false, err
	}
	head := make([]byte, 512)
	n, _ := io.ReadFull(f, head)
	return images.Is(head[:n]), nil
}

// attachmentName is name with the extension of the image as kept, which
// shrinking may have changed; "image" for a pasted one.
func attachmentName(name, ext string) string {
	name = filepath.Base(name)
	if name == "" || name == "." || name == string(filepath.Separator) {
		name = "image"
	}
	old := filepath.Ext(name)
	if strings.EqualFold(old, ext) || (ext == ".jpg" && strings.EqualFold(old, ".jpeg")) {
		return name
	}
	return strings.TrimSuffix(name, old) + ext
}

// DiscardAttachment removes an attachment that was not sent, as one the
// user took back. One a message carries stays.
func (w *Workbench) DiscardAttachment(a model.Attachment) error {
	session, _, _ := strings.Cut(a.File, "/")
	w.mu.Lock()
	if s, ok := w.sessions[session]; ok {
		for _, m := range s.msgs {
			for _, x := range m.Attachments {
				if x.File == a.File {
					w.mu.Unlock()
					return nil
				}
			}
		}
	}
	w.mu.Unlock()
	return w.st.RemoveAttachment(a.File)
}

// AttachmentPath is where an attachment's file is, as for showing it; ""
// for a file name not an attachment's.
func (w *Workbench) AttachmentPath(a model.Attachment) string {
	return w.st.AttachmentPath(a.File)
}

// turnImages are the images a session's message carries, as its Agent
// takes them: each the session's own, its file there.
func (w *Workbench) turnImages(sessionID string, as []model.Attachment) ([]agent.Image, error) {
	var out []agent.Image
	for _, a := range as {
		p := w.st.AttachmentPath(a.File)
		if p == "" || !strings.HasPrefix(a.File, sessionID+"/") {
			return nil, ErrAttachmentGone
		}
		if _, err := os.Stat(p); err != nil {
			return nil, ErrAttachmentGone
		}
		out = append(out, agent.Image{Path: p, MIME: a.MIME})
	}
	return out, nil
}
