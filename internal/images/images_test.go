package images_test

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"math/rand"
	"testing"

	"github.com/chldu2000/aibo/internal/images"
)

func encode(t *testing.T, w, h int, noise bool, enc func(*bytes.Buffer, image.Image) error) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	r := rand.New(rand.NewSource(1))
	for i := range img.Pix {
		if noise {
			img.Pix[i] = byte(r.Intn(256))
		} else {
			img.Pix[i] = 200
		}
	}
	var buf bytes.Buffer
	if err := enc(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func pngEnc(b *bytes.Buffer, i image.Image) error { return png.Encode(b, i) }

// A small image is kept as it is, with its type.
func TestReadyKeeps(t *testing.T) {
	for name, data := range map[string][]byte{
		"png":  encode(t, 30, 20, false, pngEnc),
		"jpeg": encode(t, 30, 20, false, func(b *bytes.Buffer, i image.Image) error { return jpeg.Encode(b, i, nil) }),
		"gif": encode(t, 30, 20, false, func(b *bytes.Buffer, i image.Image) error {
			return gif.Encode(b, image.NewPaletted(i.Bounds(), color.Palette{color.White}), nil)
		}),
	} {
		img, err := images.Ready(data)
		if err != nil || !bytes.Equal(img.Data, data) || img.Width != 30 || img.Height != 20 || img.MIME != "image/"+name {
			t.Errorf("%s → %s %dx%d, %v", name, img.MIME, img.Width, img.Height, err)
		}
	}
}

// An image too wide, or of too many bytes, is shrunk to ShrinkSide.
func TestReadyShrinks(t *testing.T) {
	wide, err := images.Ready(encode(t, images.MaxSide+100, 10, false, pngEnc))
	if err != nil || wide.Width != images.ShrinkSide || wide.Height != 2 || wide.MIME != "image/png" {
		t.Errorf("wide → %s %dx%d, %v", wide.MIME, wide.Width, wide.Height, err)
	}
	noisy := encode(t, 2500, 1200, true, pngEnc)
	if len(noisy) <= images.MaxBytes {
		t.Fatalf("the noise is only %d bytes", len(noisy))
	}
	img, err := images.Ready(noisy)
	if err != nil || len(img.Data) > images.MaxBytes || img.Width != images.ShrinkSide {
		t.Errorf("noisy → %s %dx%d %d bytes, %v", img.MIME, img.Width, img.Height, len(img.Data), err)
	}
	if got, _, err := image.Decode(bytes.NewReader(img.Data)); err != nil || got.Bounds().Dx() != img.Width {
		t.Errorf("the shrunk image does not decode: %v", err)
	}
}

func TestReadyRefuses(t *testing.T) {
	for name, data := range map[string][]byte{
		"text":   []byte("hello"),
		"pdf":    []byte("%PDF-1.7\n"),
		"broken": append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 40)...),
	} {
		if _, err := images.Ready(data); !errors.Is(err, images.ErrUnsupported) {
			t.Errorf("%s → %v", name, err)
		}
	}
}
