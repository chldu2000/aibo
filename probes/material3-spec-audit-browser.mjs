import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createBuiltinWorkbenchServer } from './lib/builtin-workbench-fixture.mjs';
import { assertMaterial3Tokens } from './lib/material3-token-scan.mjs';

// Audits rendered Material 3 components against the official design tokens shipped with
// @material/web (see the fixture's `source`). Expected values come only from that excerpt;
// the one adjustment is the documented M3 density scale (each step is 4px), declared per role.
const official = JSON.parse(await readFile(new URL('./fixtures/material3-official-tokens.json', import.meta.url), 'utf8'));
const comp = official.comp, focus = official.sys['focus-indicator'];
const DENSITY = { field: -3, list: -3, table: -3 };
const dense = (value, role) => value + DENSITY[role] * 4;
const output = process.env.AIBO_PROBE_OUTPUT ?? '/tmp/aibo-material3-audit';
await mkdir(output, { recursive: true });
const results = [];
const check = (component, property, expected, actual) => {
  const pass = typeof expected === 'number' ? Math.abs(expected - actual) < 0.6 : expected === actual;
  results.push({ component, property, expected, actual, pass });
};

// Resolves a system colour role on the current theme to computed rgb().
const roleColor = (page, role) => page.evaluate(role => {
  const probe = document.createElement('i');
  probe.style.color = `var(--md-sys-color-${role})`;
  document.querySelector('.app-shell').append(probe);
  const value = getComputedStyle(probe).color; probe.remove(); return value;
}, role);
const style = (locator, pseudo = null) => locator.evaluate((element, pseudo) => {
  const s = getComputedStyle(element, pseudo), r = element.getBoundingClientRect();
    // Browsers clamp radii to half the shorter side, so compare the corner that actually renders.
  const clamp = value => Math.min(parseFloat(value), Math.min(r.width, r.height) / 2);
  // Pseudo-elements have no box of their own here; read their computed size instead.
  return { width: pseudo ? parseFloat(s.width) : r.width, height: pseudo ? parseFloat(s.height) : r.height, radius: clamp(s.borderTopLeftRadius), radiusEnd: clamp(s.borderTopRightRadius),
    borderWidth: parseFloat(s.borderTopWidth), borderColor: s.borderTopColor, background: s.backgroundColor, color: s.color,
    paddingLeft: parseFloat(s.paddingLeft), fontSize: parseFloat(s.fontSize), fontWeight: s.fontWeight, boxShadow: s.boxShadow,
    outlineWidth: parseFloat(s.outlineWidth), outlineColor: s.outlineColor, outlineOffset: parseFloat(s.outlineOffset),
    afterWidth: parseFloat(getComputedStyle(element, '::after').width), afterHeight: parseFloat(getComputedStyle(element, '::after').height),
    afterBackground: getComputedStyle(element, '::after').backgroundColor, gap: parseFloat(s.rowGap), caret: s.caretColor };
}, pseudo);
const radiusOf = (value, height) => Math.min(value, height / 2); // corner-full renders as half the height

async function auditControls(browser, port, theme) {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1100, height: 1000 } });
  await page.goto(`http://127.0.0.1:${port}/__controls?kit=material3`);
  if (await page.locator('.app-shell').getAttribute('data-ui-theme') !== theme) await page.getByRole('button', { name: '切换主题' }).click();
  const c = role => roleColor(page, role);
  const variant = name => page.locator('.variant-fixture [data-slot="button"]').filter({ hasText: new RegExp(`^${name}$`) }).first();
  const button = comp['button-small'];
  const filled = await style(variant('default'));
  check('button', 'container-height', button['container-height'], filled.height);
  check('button', 'container-shape-round', radiusOf(button['container-shape-round'], filled.height), filled.radius);
  check('button', 'leading-space', button['leading-space'], filled.paddingLeft);
  check('button', 'label-text-size', comp['filled-button']['label-text-size'], filled.fontSize);
  check('button', 'label-text-weight (medium)', '500', filled.fontWeight);
  check('button-filled', 'container-color', await c(comp['button-filled']['container-color'].color), filled.background);
  check('button-filled', 'label-text-color', await c(comp['button-filled']['label-text-color'].color), filled.color);
  const tonal = await style(variant('secondary'));
  check('button-tonal', 'container-color', await c(comp['button-tonal']['container-color'].color), tonal.background);
  check('button-tonal', 'label-text-color', await c(comp['button-tonal']['label-text-color'].color), tonal.color);
  const outlined = await style(variant('outline'));
  check('button-outlined', 'outline-color', await c(comp['button-outlined']['outline-color'].color), outlined.borderColor);
  check('button-outlined', 'label-text-color', await c(comp['button-outlined']['label-text-color'].color), outlined.color);
  await variant('default').hover(); await page.mouse.down(); await page.waitForTimeout(400);
  check('button', 'pressed-container-shape', button['pressed-container-shape'], (await style(variant('default'))).radius);
  await page.mouse.up(); await page.mouse.move(0, 0);
  await variant('default').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  const focused = await style(variant('default'));
  check('focus-indicator', 'thickness', focus.thickness, focused.outlineWidth);
  check('focus-indicator', 'outer-offset', focus['outer-offset'], focused.outlineOffset);
  check('focus-indicator', 'color (secondary)', await c('secondary'), focused.outlineColor);

  const checkbox = page.getByRole('checkbox', { name: '复选选择' });
  if (await checkbox.isChecked()) await checkbox.uncheck();
  const box = await style(checkbox);
  check('checkbox', 'container-size', comp.checkbox['container-size'], box.width);
  check('checkbox', 'container-shape', comp.checkbox['container-shape'], box.radius);
  check('checkbox', 'unselected-outline-width', comp.checkbox['unselected-outline-width'], box.borderWidth);
  await page.mouse.move(0, 0);
  check('checkbox', 'unselected-outline-color', await c(comp.checkbox['unselected-outline-color'].color), (await style(checkbox)).borderColor);
  await checkbox.check(); await page.mouse.move(0, 0); await page.locator('body').focus();
  check('checkbox', 'selected-container-color', await c(comp.checkbox['selected-container-color'].color), (await style(checkbox)).background);
  check('checkbox', 'state-layer-size', comp.checkbox['state-layer-size'], (await style(checkbox, '::before')).width);

  const radio = page.getByRole('radio', { name: '第二个' });
  await radio.check(); await page.mouse.move(0, 0);
  const radioStyle = await style(radio);
  check('radio-button', 'icon-size', comp['radio-button']['icon-size'], radioStyle.width);
  check('radio-button', 'selected-icon-color', await c(comp['radio-button']['selected-icon-color'].color), radioStyle.borderColor);
  check('radio-button', 'selected dot colour', await c(comp['radio-button']['selected-icon-color'].color), radioStyle.afterBackground);

  const toggle = page.getByRole('switch', { name: '开关选择' });
  if (await toggle.isChecked()) await toggle.uncheck();
  await page.mouse.move(0, 0); await page.locator('body').focus();
  const off = await style(toggle);
  check('switch', 'track-width', comp.switch['track-width'], off.width);
  check('switch', 'track-height', comp.switch['track-height'], off.height);
  check('switch', 'track-outline-width', comp.switch['track-outline-width'], off.borderWidth);
  check('switch', 'unselected-track-color', await c(comp.switch['unselected-track-color'].color), off.background);
  check('switch', 'unselected-track-outline-color', await c(comp.switch['unselected-track-outline-color'].color), off.borderColor);
  check('switch', 'unselected-handle-width', comp.switch['unselected-handle-width'], off.afterWidth);
  check('switch', 'unselected-handle-color', await c(comp.switch['unselected-handle-color'].color), off.afterBackground);
  await toggle.check(); await page.mouse.move(0, 0); await page.locator('body').focus(); await page.waitForTimeout(400);
  const on = await style(toggle);
  check('switch', 'selected-track-color', await c(comp.switch['selected-track-color'].color), on.background);
  check('switch', 'selected-handle-width', comp.switch['selected-handle-width'], on.afterWidth);
  check('switch', 'selected-handle-color', await c(comp.switch['selected-handle-color'].color), on.afterBackground);
  await toggle.hover(); await page.mouse.down(); await page.waitForTimeout(400);
  check('switch', 'pressed-handle-width', comp.switch['pressed-handle-width'], (await style(toggle)).afterWidth);
  await page.mouse.up(); await page.mouse.move(0, 0);

  const field = page.getByRole('textbox', { name: '普通输入' });
  const fieldStyle = await style(field);
  const text = comp['outlined-text-field'];
  check('outlined-text-field', 'container-shape', text['container-shape'], fieldStyle.radius);
  check('outlined-text-field', 'outline-width', text['outline-width'], fieldStyle.borderWidth);
  check('outlined-text-field', 'outline-color', await c(text['outline-color'].color), fieldStyle.borderColor);
  check('outlined-text-field', `height (56px, density ${DENSITY.field})`, dense(56, 'field'), fieldStyle.height);
  check('outlined-text-field', 'input-text-size', text['input-text-size'], fieldStyle.fontSize);
  check('outlined-text-field', 'caret-color', await c(text['caret-color'].color), fieldStyle.caret);
  await field.hover();
  check('outlined-text-field', 'hover-outline-color', await c(text['hover-outline-color'].color), (await style(field)).borderColor);
  await field.focus();
  const fieldFocused = await style(field);
  check('outlined-text-field', 'focus-outline-color', await c(text['focus-outline-color'].color), fieldFocused.borderColor);
  const inset = Number(/ (\d+)px inset$/.exec(fieldFocused.boxShadow)?.[1] ?? 0);
  check('outlined-text-field', 'focus-outline-width', text['focus-outline-width'], fieldFocused.borderWidth + inset);
  await page.mouse.move(0, 0);

  await page.getByRole('combobox', { name: '皮肤选择' }).click();
  await assertMaterial3Tokens(page, `select menu ${theme}`);
  const list = page.getByRole('listbox', { name: '皮肤选择' });
  const menu = await style(list);
  const menus = comp.menus;
  check('menus', 'container-shape', menus['container-shape'], menu.radius);
  check('menus', 'container-color', await c(comp['menus-standard']['container-color'].color), menu.background);
  check('menus', 'group-padding', menus['group-padding'], menu.paddingLeft);
  check('menus', 'gap', menus.gap, menu.gap);
  const options = list.getByRole('option');
  const selected = await style(options.first()), item = await style(options.nth(1));
  check('menus', 'menu-item-height', menus['menu-item-height'], item.height);
  check('menus', 'menu-item-leading-space', menus['menu-item-leading-space'], item.paddingLeft);
  check('menus', 'menu-item-label-text-size', menus['menu-item-label-text-size'], item.fontSize);
  check('menus', 'menu-item-selected-shape', menus['menu-item-selected-shape'], selected.radius);
  check('menus', 'menu-item-selected-container-color', await c(comp['menus-standard']['menu-item-selected-container-color'].color), selected.background);
  check('menus', 'menu-item-selected-label-text-color', await c(comp['menus-standard']['menu-item-selected-label-text-color'].color), selected.color);
  await page.keyboard.press('Escape');
  await page.close();
}

async function auditWorkbench(browser, port, theme) {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 960 } });
  await page.addInitScript(theme => localStorage.setItem('aibo.appearance.v1', JSON.stringify({ kitId: 'material3', themeId: theme })), theme);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('.assistant-entry').waitFor();
  const c = role => roleColor(page, role);

  const active = await style(page.locator('.conversation-navigation > .ui-button[aria-selected="true"]').first());
  const inactive = await style(page.locator('.conversation-navigation > .ui-button[aria-selected="false"]').first());
  const tab = comp['primary-navigation-tab'];
  check('primary-navigation-tab', 'container-height', tab['container-height'], active.height);
  check('primary-navigation-tab', 'label-text-size', tab['with-label-text-label-text-size'], active.fontSize);
  check('primary-navigation-tab', 'active-label-text-color', await c(tab['with-label-text-active-label-text-color'].color), active.color);
  check('primary-navigation-tab', 'inactive-label-text-color', await c(tab['with-label-text-inactive-label-text-color'].color), inactive.color);
  check('primary-navigation-tab', 'active-indicator-height', tab['active-indicator-height'], active.afterHeight);
  check('primary-navigation-tab', 'active-indicator-color', await c(tab['active-indicator-color'].color), active.afterBackground);

  const handle = comp['drag-handle'];
  const splitter = page.locator('.workspace-splitter').first();
  check('drag-handle', 'container-width', handle['container-width'], (await style(splitter)).width);
  const grip = await style(splitter.locator('.workspace-splitter-line'));
  check('drag-handle', 'width', handle.width, grip.width);
  check('drag-handle', 'height', handle.height, grip.height);
  check('drag-handle', 'shape', radiusOf(handle.shape, grip.width), grip.radius);
  check('drag-handle', 'color', await c(handle.color.color), grip.background);

  const card = comp['outlined-card'];
  const toolCard = await style(page.locator('.timeline-entry.tool-entry').first());
  check('outlined-card (tool record)', 'container-shape', card['container-shape'], toolCard.radius);
  check('outlined-card (tool record)', 'container-color', await c(card['container-color'].color), toolCard.background);
  check('outlined-card (tool record)', 'outline-color', await c(card['outline-color'].color), toolCard.borderColor);
  check('outlined-card (tool record)', 'outline-width', card['outline-width'], toolCard.borderWidth);

  const fab = await style(page.locator('.sidebar-new-session'));
  check('extended-fab-small', 'container-height', comp['extended-fab-small']['container-height'], fab.height);
  check('extended-fab-small', 'container-shape', comp['extended-fab-small']['container-shape'], fab.radius);

  const rail = await style(page.locator('.sidebar-tool-rail'));
  const narrow = comp['nav-rail-collapsed'];
  check('nav-rail (tool rail)', 'narrow-container-width', narrow['narrow-container-width'], rail.width);
  check('nav-rail (tool rail)', 'container-color', await c(narrow['container-color'].color), rail.background);
  check('nav-rail (tool rail)', 'item-vertical-space', narrow['item-vertical-space'], (await style(page.locator('.sidebar-tool-list'))).gap);
  const pressed = page.locator('.sidebar-tool[aria-pressed="true"]').first();
  const indicator = await style(pressed.locator('.sidebar-tool-icon'));
  check('nav-rail-item', 'short-container-height', comp['nav-rail-item']['short-container-height'], (await style(pressed)).height);
  check('nav-rail-item', 'active-indicator-width', comp['nav-rail-item-vertical']['active-indicator-width'], indicator.width);
  check('nav-rail-item', 'active-indicator-height', comp['nav-rail-item-vertical']['active-indicator-height'], indicator.height);
  check('nav-rail-item', 'active-indicator-shape', radiusOf(comp['nav-rail-item']['active-indicator-shape'], indicator.height), indicator.radius);
  check('nav-rail-item', 'active indicator colour', await c('secondary-container'), indicator.background);
  check('nav-rail-item', 'icon-size', comp['nav-rail-item']['icon-size'], (await style(pressed.locator('svg'))).width);

  const drawerItem = await style(page.locator('.session-item-row.selected').first());
  const drawer = comp['navigation-drawer'];
  check('navigation-drawer item', `active-indicator-height (56px, density ${DENSITY.list})`, dense(drawer['active-indicator-height'], 'list'), drawerItem.height);
  check('navigation-drawer item', 'active-indicator-shape', radiusOf(drawer['active-indicator-shape'], drawerItem.height), drawerItem.radius);
  check('navigation-drawer item', 'active indicator colour', await c('secondary-container'), drawerItem.background);

  // Row action menu: an Expressive menu opened from the selected session row.
  await page.locator('.session-item-row.selected').hover(); await page.getByRole('button', { name: '重构默认视觉体验 更多操作', exact: true }).click();
  const rowMenu = page.locator('.row-action-menu:popover-open');
  await rowMenu.waitFor();
  const rowMenuStyle = await style(rowMenu);
  check('menus (row actions)', 'container-shape', comp.menus['container-shape'], rowMenuStyle.radius);
  check('menus (row actions)', 'container-color', await c(comp['menus-standard']['container-color'].color), rowMenuStyle.background);
  check('menus (row actions)', 'menu-item-height', comp.menus['menu-item-height'], (await style(rowMenu.locator('.ui-button').first())).height);
  await assertMaterial3Tokens(page, `row menu ${theme}`);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
  await assertMaterial3Tokens(page, `collapsed sidebar ${theme}`);
  await page.waitForTimeout(400); // let the shape spring settle
  const sidebar = await style(page.locator('[data-ui-component="workspace-sidebar"]'));
  check('nav-rail (collapsed sidebar)', 'narrow-container-width', narrow['narrow-container-width'], sidebar.width);
  const smallFab = await style(page.locator('.sidebar-new-session'));
  check('fab-small (collapsed sidebar)', 'container-height', comp['fab-small']['container-height'], smallFab.height);
  check('fab-small (collapsed sidebar)', 'container-shape', comp['fab-small']['container-shape'], smallFab.radius);
  await page.getByRole('button', { name: '展开导航栏', exact: true }).click();

  await page.getByRole('button', { name: /^打开工作台设置/ }).click();
  const dialog = page.getByRole('dialog', { name: '工作台设置', exact: true });
  await dialog.waitFor();
  await assertMaterial3Tokens(page, `settings dialog ${theme}`);
  const kitCard = await style(dialog.locator('.appearance-kit-option').first());
  check('outlined-card (skin option)', 'container-shape', comp['outlined-card']['container-shape'], kitCard.radius);
  const dialogStyle = await style(dialog);
  check('dialog', 'container-shape', comp.dialog['container-shape'], dialogStyle.radius);
  check('dialog', 'container-color', await c(comp.dialog['container-color'].color), dialogStyle.background);
  check('dialog', 'headline-size', comp.dialog['headline-size'], (await style(dialog.locator('h1').first())).fontSize);
  const scrim = await dialog.evaluate(element => getComputedStyle(element, '::backdrop').backgroundColor);
  const scrimRgb = await page.evaluate(([role, opacity]) => {
    const probe = document.createElement('i'); probe.style.color = `color-mix(in srgb, var(--md-sys-color-${role}) ${opacity * 100}%, transparent)`;
    document.querySelector('.app-shell').append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value;
  }, [comp.scrim['container-color'].color, comp.scrim['container-opacity']]);
  check('scrim', 'container-color × container-opacity', scrimRgb, scrim);
  const group = dialog.locator('.appearance-mode-control').first();
  const segments = group.locator('.appearance-mode-option');
  const connected = comp['button-group-connected-small'];
  check('button-group-connected', 'between-space', connected['between-space'], (await group.evaluate(e => parseFloat(getComputedStyle(e).columnGap))));
  const firstSegment = await style(segments.first());
  check('button-group-connected', 'container-height', connected['container-height'], firstSegment.height);
  check('button-group-connected', 'inner-corner-corner-size', connected['inner-corner-corner-size'], firstSegment.radiusEnd > firstSegment.height / 2 - 1 ? (await style(segments.nth(1))).radius : firstSegment.radiusEnd);
  check('button-group-connected', 'selected tonal colour (secondary)', await c('secondary'), (await style(group.locator('.appearance-mode-option.active'))).background);
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__auditProbe.notify('已保存', 'success'));
  const toast = await style(page.locator('.toast').first());
  const snackbar = comp.snackbar;
  check('snackbar', 'container-shape', snackbar['container-shape'], toast.radius);
  check('snackbar', 'container-color', await c(snackbar['container-color'].color), toast.background);
  check('snackbar', 'supporting-text-color', await c(snackbar['supporting-text-color'].color), toast.color);
  check('snackbar', 'with-single-line-container-height', snackbar['with-single-line-container-height'], toast.height);
  check('snackbar', 'icon colour (inverse-on-surface)', await c('inverse-on-surface'), (await style(page.locator('.toast .toast-symbol').first())).color);
  await page.screenshot({ path: `${output}/workbench-${theme}.png` });
  await page.close();
}

const controls = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null }, plugins: [{
  name: 'material3-audit-controls', configureServer(server) {
    server.middlewares.use('/__controls', (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html><body><div id="app"></div><script type="module" src="/probes/fixtures/ak-ui-controls.mjs"></script></body></html>');
    });
  },
}] });
// Only this fixture exposes the notice producer, so the real AppOverlays renders the snackbar.
const workbench = createBuiltinWorkbenchServer({ plugins: [{
  name: 'material3-audit-notice', enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('/src/App.svelte')) return code.replace('</script>', '(window as any).__auditProbe = { notify: setNotice };\n</script>');
  },
}] });
const browser = await chromium.launch({ headless: true });
try {
  await controls.listen(); const app = await workbench; await app.listen();
  for (const theme of ['light', 'dark']) {
    await auditControls(browser, controls.httpServer.address().port, theme);
    await auditWorkbench(browser, app.httpServer.address().port, theme);
  }
  await app.close();
} finally {
  await browser.close(); await controls.close();
}
await writeFile(`${output}/audit.json`, JSON.stringify({ source: official.source, density: DENSITY, results }, null, 1));
const failures = results.filter(result => !result.pass);
for (const failure of failures) console.log(`FAIL ${failure.component} ${failure.property}: expected ${failure.expected}, got ${failure.actual}`);
assert.equal(failures.length, 0, `${failures.length} of ${results.length} checks differ from the official tokens`);
console.log(`PASS: ${results.length} checks across ${new Set(results.map(result => result.component)).size} components match ${official.source} in light and dark. Report: ${output}/audit.json`);
