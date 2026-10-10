// Whole-surface Material 3 conformance scan. Every visible element in the current page state
// must draw only with system tokens: colour roles (or a role at an official state, disabled
// or scrim opacity), the shape scale, the type scale, elevation levels and component sizes.
export const OPACITIES = [0.08, 0.1, 0.12, 0.16, 0.32, 0.38];
export const SHAPES = [0, 2, 3, 4, 8, 12, 16, 20, 28, 32, 48];
export const TYPE_SIZES = [11, 12, 14, 16, 22, 24, 28, 32, 36, 45, 57];
export const WEIGHTS = ['400', '500', '700'];
// Interactive heights: XS 32 / S 40 buttons, menu items and density −3 rows/fields 44, tabs and touch 48,
// data-table rows 52 (40 at density −3), FABs and one-line rows 56, two-line rows 72 (60 at −3),
// three-line rows 88 (76 at −3).
export const TARGET_HEIGHTS = [32, 40, 44, 48, 52, 56, 60, 72, 76, 88];

export async function scanMaterial3(page, label) {
  return page.evaluate(({ OPACITIES, SHAPES, TYPE_SIZES, WEIGHTS, TARGET_HEIGHTS, label }) => {
    const shell = document.querySelector('.app-shell[data-ui-kit="material3"]');
    if (!shell) return [`${label}: Material 3 shell missing`];
    const probe = document.createElement('i'); shell.append(probe);
    const rgb = value => { probe.style.color = ''; probe.style.color = value; return getComputedStyle(probe).color; };
    const parse = value => { const m = /rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)/.exec(value) ?? /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/.exec(value);
      if (!m) return null; const scale = value.startsWith('color(') ? 255 : 1;
      return [+m[1] * scale, +m[2] * scale, +m[3] * scale, m[4] === undefined ? 1 : +m[4]]; };
    const roles = [...new Set([...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } })
      .map(rule => rule.cssText).join(' ').match(/--md-sys-color-[a-z-]+/g) ?? [])];
    const declared = [...shell.style].filter(name => name.startsWith('--md-sys-color-') || /^--aibo-(success|warning)-/.test(name));
    const palette = [...new Set([...roles, ...declared])].map(name => parse(rgb(`var(${name})`))).filter(Boolean);
    const near = (a, b) => Math.abs(a - b) <= 1.5;
    const colorOk = value => {
      const c = parse(value); if (!c || c[3] === 0) return true;
      return palette.some(p => {
        if (c[3] >= 0.995) return near(c[0], p[0]) && near(c[1], p[1]) && near(c[2], p[2]);
        return OPACITIES.some(a => Math.abs(c[3] - a) < 0.006) && near(c[0], p[0]) && near(c[1], p[1]) && near(c[2], p[2]);
      });
    };
    const elevations = ['--md-sys-elevation-level1', '--md-sys-elevation-level2', '--md-sys-elevation-level3'].map(name => {
      probe.style.boxShadow = `var(${name})`; return getComputedStyle(probe).boxShadow; });
    probe.remove();
    const shadowOk = value => value === 'none' || elevations.includes(value)
      || /^(rgba?\([^)]*\)|color\([^)]*\)) 0px 0px 0px \d+px( inset)?$/.test(value);
    const issues = new Map();
    const report = (element, problem) => {
      const key = `${problem} @ ${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
      issues.set(key, (issues.get(key) ?? 0) + 1);
    };
    for (const element of shell.querySelectorAll('*')) {
      if (element.closest('svg') && element.tagName !== 'svg') continue;
      // Palette previews intentionally paint other themes' colours.
      if (element.closest('.appearance-palette-preview, .theme-swatches')) continue;
      const r = element.getBoundingClientRect();
      const s = getComputedStyle(element);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
      const hasText = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
      if (hasText || element.matches('input, textarea, select')) {
        if (!colorOk(s.color)) report(element, `text colour ${s.color}`);
        const size = parseFloat(s.fontSize);
        // font-size 0 is a deliberate text hide.
        if (size > 0 && !TYPE_SIZES.some(t => Math.abs(t - size) < 0.1)) report(element, `font-size ${size}px`);
        if (!WEIGHTS.includes(s.fontWeight)) report(element, `font-weight ${s.fontWeight}`);
      }
      if (!colorOk(s.backgroundColor)) report(element, `background ${s.backgroundColor}`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left'])
        if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && !colorOk(s[`border${side}Color`])) { report(element, `border colour ${s[`border${side}Color`]}`); break; }
      if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && !colorOk(s.outlineColor)) report(element, `outline colour ${s.outlineColor}`);
      const full = Math.min(r.width, r.height) / 2;
      for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']) {
        const value = s[corner].endsWith('%') ? (parseFloat(s[corner]) >= 50 ? full : -1) : Math.min(parseFloat(s[corner]), full);
        if (!(value >= full - 0.5) && !SHAPES.some(shape => Math.abs(shape - value) < 0.5)) { report(element, `corner ${s[corner]}`); break; }
      }
      if (!shadowOk(s.boxShadow)) report(element, `shadow ${s.boxShadow}`);
      const interactive = element.matches('button, [role="button"], [role="tab"], [role="option"], [role="menuitem"], select, summary, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"])');
      // Drag handles span their pane and clickable cards size to content; neither has a fixed M3 height.
      if (interactive && !element.closest('.markdown-content') && !element.matches('.workspace-splitter, [role="separator"], [data-slot="card"], .subagent-card, .appearance-kit-option, .appearance-theme-option') && !TARGET_HEIGHTS.some(height => Math.abs(height - r.height) < 0.6)) report(element, `height ${Math.round(r.height * 10) / 10}px`);
    }
    return [...issues].map(([key, count]) => `${label}: ${key}${count > 1 ? ` ×${count}` : ''}`);
  }, { OPACITIES, SHAPES, TYPE_SIZES, WEIGHTS, TARGET_HEIGHTS, label });
}

/** Fails with every off-token value found in the current state; no-op for other kits. */
export async function assertMaterial3Tokens(page, label) {
  if (!await page.locator('.app-shell[data-ui-kit="material3"]').count()) return;
  await page.mouse.move(0, 0);
  // Measure settled values: wait for finite transitions (shape springs, colour fades) to end.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {}))));
  const issues = await scanMaterial3(page, label);
  if (issues.length) throw new Error(`Material 3 token scan found ${issues.length} off-token values:\n${issues.join('\n')}`);
}
