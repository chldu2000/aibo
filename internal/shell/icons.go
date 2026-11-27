package shell

import (
	"github.com/egoist/mygo/plugins/sfsymbols"
	"github.com/egoist/mygo/ui"
)

// icon uses the system symbol when available. MyGO tints the fallback
// with the same foreground color as the native symbol.
func icon(c *ui.Context, name string) sfsymbols.SymbolElement {
	return sfsymbols.Symbol(c, name).Fallback(iconFallbacks[name])
}

func glyph(body string) *ui.SVG {
	return ui.MustParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` + body + `</g></svg>`))
}

var iconFallbacks = map[string]*ui.SVG{
	"checkmark.circle":                   glyph(`<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>`),
	"exclamationmark.circle":             glyph(`<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3.5v.5"/>`),
	"number":                             glyph(`<path d="M5 9h15M4 15h15M10 4 8 20m8-16-2 16"/>`),
	"questionmark.circle":                glyph(`<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4m0 3v.2"/>`),
	"xmark.circle":                       glyph(`<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>`),
	"archivebox":                         glyph(`<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9m-9 4h4"/>`),
	"doc.on.doc":                         glyph(`<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>`),
	"pencil":                             glyph(`<path d="M16 3l5 5L8 21H3v-5Z"/>`),
	"trash":                              glyph(`<path d="M4 6h16M9 6V4h6v2m-9 0 1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/>`),
	"tray.and.arrow.up":                  glyph(`<path d="M3 14v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5h-5a4 4 0 0 1-8 0Zm9-11v9m-4-5 4-4 4 4"/>`),
	"info.circle":                        glyph(`<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-9.5v.5"/>`),
	"minus":                              glyph(`<path d="M4 12h16"/>`),
	"square":                             glyph(`<rect x="4" y="4" width="16" height="16" rx="1"/>`),
	"arrow.down.right.and.arrow.up.left": glyph(`<path d="M3 3l7 7m0-5v5H5m16 11-7-7m5 0h-5v5"/>`),
	"arrow.turn.down.right":              glyph(`<path d="M5 3v8a4 4 0 0 0 4 4h11m-5-5 5 5-5 5"/>`),
	"arrow.triangle.branch":              glyph(`<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v12m12-10c0 5-12 3-12 9"/>`),
	"arrow.down":                         glyph(`<path d="M12 4v16m-7-7 7 7 7-7"/>`),
	"arrow.up":                           glyph(`<path d="M12 20V4m-7 7 7-7 7 7"/>`),
	"arrowshape.turn.up.right":           glyph(`<path d="M21 10 13 3v4C6 7 3 12 3 20c3-5 6-7 10-7v4Z"/>`),
	"at":                                 glyph(`<circle cx="11" cy="12" r="4"/><path d="M15 8v6c0 4 6 2 6-3a9 9 0 1 0-5 9"/>`),
	"checkmark.circle.fill":              glyph(`<circle cx="12" cy="12" r="9"/><path d="m7 12 3.5 3.5L17 9"/>`),
	"checkmark.shield":                   glyph(`<path d="M12 2 3 6v6c0 5 5 8 9 10 4-2 9-5 9-10V6Zm-4 10 3 3 5-6"/>`),
	"chevron.left":                       glyph(`<path d="m15 4-8 8 8 8"/>`),
	"circle":                             glyph(`<circle cx="12" cy="12" r="8"/>`),
	"circle.dotted":                      glyph(`<path d="M11 3h2m5 2 1 1m2 5v2m-2 5-1 1m-5 2h-2m-5-2-1-1m-2-5v-2m2-5 1-1"/>`),
	"cpu":                                glyph(`<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>`),
	"doc.text":                           glyph(`<path d="M5 2h9l5 5v15H5Zm9 0v6h5M8 12h8m-8 4h6"/>`),
	"exclamationmark.shield":             glyph(`<path d="M12 2 3 6v6c0 5 5 8 9 10 4-2 9-5 9-10V6Zm0 5v6m0 3v.5"/>`),
	"eye":                                glyph(`<path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0Z"/><circle cx="12" cy="12" r="2.5"/>`),
	"folder":                             glyph(`<path d="M3 6h6l2 3h10v11H3Z"/>`),
	"folder.badge.plus":                  glyph(`<path d="M11 20H2V5h7l2 3h10v4m-4 2v8m-4-4h8"/>`),
	"gauge.with.dots.needle.33percent":   glyph(`<path d="M3 18a10 10 0 1 1 18 0Zm9-4 5-6M6 13H5m2-5 1 1m4-4v1"/>`),
	"gearshape":                          glyph(`<path d="m10 2 4 0 .7 3 2 .9 2.7-1.2 2 3.5-2.1 2.2v3.2l2.1 2.2-2 3.5-2.7-1.2-2 .9-.7 3h-4l-.7-3-2-.9-2.7 1.2-2-3.5 2.1-2.2v-3.2L2.6 8.2l2-3.5 2.7 1.2 2-.9Z"/><circle cx="12" cy="12" r="3.2"/>`),
	"paperclip":                          glyph(`<path d="M8 14 15.5 6.5a2.1 2.1 0 0 1 3 3L10 18a4 4 0 0 1-6-6l9-9a6 6 0 0 1 8 8l-9 9"/>`),
	"photo":                              glyph(`<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>`),
	"person.2":                           glyph(`<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-8 14-8 14 0m0-15c5 0 5 7 0 7m2 2c3 1 4 3 4 6"/>`),
	"plus":                               glyph(`<path d="M12 4v16M4 12h16"/>`),
	"rectangle.on.rectangle":             glyph(`<rect x="8" y="8" width="13" height="12" rx="2"/><path d="M5 15H3V3h13v2"/>`),
	"sidebar.leading":                    glyph(`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M9 4v16"/>`),
	"sidebar.trailing":                   glyph(`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M15 4v16"/>`),
	"stop.fill":                          glyph(`<rect x="5" y="5" width="14" height="14" rx="2" fill="black"/>`),
	"terminal":                           glyph(`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m5 8 4 4-4 4m7 0h5"/>`),
	"wifi.exclamationmark":               glyph(`<path d="M2 8a15 15 0 0 1 15-3M5 12a10 10 0 0 1 11-3m-8 7a5 5 0 0 1 6-1m-3 5h.1M20 8v7m0 4v.5"/>`),
	"xmark":                              glyph(`<path d="m5 5 14 14M19 5 5 19"/>`),
}
