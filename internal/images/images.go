// Package images readies an image for an Agent: it checks the image is
// one both Agents take (PNG, JPEG, GIF or WebP), and shrinks one too large
// for them.
package images

import (
	"bytes"
	"errors"
	"image"
	_ "image/gif" // its decoder, for DecodeConfig and Decode
	"image/jpeg"
	"image/png"
	"net/http"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// The limits of an image as an Agent takes it. Claude's API takes up to
// 5 MB of base64 and 8000 pixels a side; MaxBytes leaves room for the
// base64.
const (
	MaxBytes = 3_500_000
	MaxSide  = 8000
	// ShrinkSide is the longer side of a shrunk image: larger, the model
	// scales it down itself.
	ShrinkSide = 2048
	// maxPixels refuses to decode an image so large that decoding it
	// would take gigabytes; maxInput, to read one so large.
	maxPixels = 100_000_000
	// MaxInput is the most bytes Ready reads.
	MaxInput = 64 << 20
)

var (
	// ErrUnsupported: not a PNG, JPEG, GIF or WebP, or not readable.
	ErrUnsupported = errors.New("not a PNG, JPEG, GIF or WebP image")
	// ErrTooLarge: too large to shrink.
	ErrTooLarge = errors.New("the image is too large")
)

// Image is an image ready for an Agent.
type Image struct {
	Data []byte
	// MIME is its type; Ext the file name extension for it, ".png".
	MIME, Ext     string
	Width, Height int
}

var exts = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}

// Is reports whether data, or its first 512 bytes, start as an image
// Ready may take.
func Is(head []byte) bool {
	_, ok := exts[http.DetectContentType(head)]
	return ok
}

// Ready checks data is an image an Agent takes, and returns it, shrunk
// when it is over MaxBytes or MaxSide: a PNG, or a JPEG when a PNG is
// still too large.
func Ready(data []byte) (Image, error) {
	if len(data) > MaxInput {
		return Image{}, ErrTooLarge
	}
	mime := http.DetectContentType(data)
	ext, ok := exts[mime]
	if !ok {
		return Image{}, ErrUnsupported
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return Image{}, ErrUnsupported
	}
	if cfg.Width*cfg.Height > maxPixels {
		return Image{}, ErrTooLarge
	}
	if len(data) <= MaxBytes && cfg.Width <= MaxSide && cfg.Height <= MaxSide {
		return Image{Data: data, MIME: mime, Ext: ext, Width: cfg.Width, Height: cfg.Height}, nil
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Image{}, ErrUnsupported
	}
	return shrink(src)
}

func shrink(src image.Image) (Image, error) {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > ShrinkSide || h > ShrinkSide {
		if w >= h {
			w, h = ShrinkSide, max(h*ShrinkSide/w, 1)
		} else {
			w, h = max(w*ShrinkSide/h, 1), ShrinkSide
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err == nil && buf.Len() <= MaxBytes {
		return Image{Data: buf.Bytes(), MIME: "image/png", Ext: ".png", Width: w, Height: h}, nil
	}
	buf.Reset()
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85}); err != nil || buf.Len() > MaxBytes {
		return Image{}, ErrTooLarge
	}
	return Image{Data: buf.Bytes(), MIME: "image/jpeg", Ext: ".jpg", Width: w, Height: h}, nil
}
