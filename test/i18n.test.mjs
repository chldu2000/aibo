import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogs, formatDateTime, formatNumber, languageStorageKey, localizedList, localizedMessage, translateMessage, parseLanguagePreference, resolveLocale, translate } from '../packages/i18n/index.js';
import { createLanguageController } from '../src/lib/app/language-controller.ts';
import { sessionBuiltinCommands } from '../src/lib/app/agent-commands.ts';
import { executionTiming } from '../src/lib/app/execution-record.ts';
import { localizeUiKit } from '../src/lib/ui-kit/theme-i18n.ts';
import { localizedSearchKindLabels } from '../src/lib/app/global-search.ts';
import { localizedHostConfirmationCategories } from '../src/lib/app/host-confirmation-controller.ts';
import { capabilityScopeLabel } from '../src/lib/app/capability-history-controller.ts';
import { executionStatus } from '../src/lib/app/execution-history-controller.ts';

function placeholders(message) {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
}

test('all languages have complete messages and matching parameters in every plural form', () => {
  const expected = Object.keys(catalogs.en).sort();
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(catalog).sort(), expected, locale);
    for (const key of expected) {
      const source = catalogs.en[key];
      const sourceText = typeof source === 'string' ? source : source.other;
      const message = catalog[key];
      const forms = typeof message === 'string' ? [message] : Object.values(message);
      if (typeof message !== 'string') assert.equal(typeof message.other, 'string', `${locale}.${key}.other`);
      for (const form of forms) {
        assert.ok(form.trim().length, `${locale}.${key} is empty`);
        assert.deepEqual(placeholders(form), placeholders(sourceText), `${locale}.${key}`);
        const parameters = Object.fromEntries(placeholders(form).map(name => [name, name === 'count' ? 2 : 'sample']));
        assert.ok(translate(locale, key, parameters));
      }
    }
  }
});

test('language resolution respects explicit choices and ordered system preferences', () => {
  assert.equal(resolveLocale('en', ['zh-CN']), 'en');
  assert.equal(resolveLocale('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveLocale('system', ['fr-FR', 'zh-Hans-CN', 'en-US']), 'zh-CN');
  assert.equal(resolveLocale('system', ['en-GB', 'zh-CN']), 'en');
  assert.equal(resolveLocale('system', ['zh-TW']), 'zh-CN');
  assert.equal(resolveLocale('system', ['fr-FR']), 'en');
  for (const value of [null, '', 'fr', '{}']) assert.equal(parseLanguagePreference(value), 'system');
});

test('language preferences persist, synchronize without echo writes, and follow system changes', () => {
  const saved = new Map([[languageStorageKey, 'zh-CN']]);
  const writes = [];
  const changes = [];
  let languages = ['en-US'];
  const controller = createLanguageController({
    storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); writes.push(value); } },
    languages: () => languages,
    changed: state => changes.push(state),
  });
  assert.deepEqual(changes.at(-1), { preference: 'zh-CN', locale: 'zh-CN' });
  controller.select('en');
  assert.equal(saved.get(languageStorageKey), 'en');
  controller.receive('zh-CN');
  assert.deepEqual(writes, ['en']);
  controller.select('system');
  assert.equal(changes.at(-1).locale, 'en');
  languages = ['zh-CN'];
  controller.refresh();
  assert.equal(changes.at(-1).locale, 'zh-CN');
  controller.select('en');
  controller.refresh();
  assert.equal(changes.at(-1).locale, 'en');
});

test('blocked storage does not prevent switching language', () => {
  const controller = createLanguageController({
    storage: { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } },
    languages: () => ['zh-CN'], changed() {},
  });
  assert.equal(controller.select('en').locale, 'en');
});

test('command localization changes descriptions while preserving capabilities and insertion identity', () => {
  const session = { pluginInstallationId: 'third-party', capabilities: ['goal.manage'] };
  const zh = sessionBuiltinCommands(session, [], 'zh-CN');
  const en = sessionBuiltinCommands(session, [], 'en');
  assert.deepEqual(zh.map(item => item.name), en.map(item => item.name));
  assert.equal(en.find(item => item.name === 'new').description, 'New session');
  assert.equal(zh.find(item => item.name === 'new').description, '新建会话');
  assert.ok(!en.some(item => item.name === 'model'));
  const control = { id: 'custom', command: 'custom', label: 'Provider-defined text' };
  assert.equal(sessionBuiltinCommands(session, [control], 'en').at(-1).description, control.label);
});

test('formatters use the selected locale and preserve the original timestamps', () => {
  assert.equal(formatNumber('en', 12345), new Intl.NumberFormat('en').format(12345));
  assert.equal(formatNumber('zh-CN', 12000, { notation: 'compact' }), new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(12000));
  assert.equal(formatDateTime('en', 'invalid'), '—');
  const record = { status: 'completed', createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:01Z' };
  const value = executionTiming(record, 'en');
  assert.equal(value.dateTime, record.createdAt);
  assert.equal(value.durationTitle, 'Time from the first record to the last update');
  assert.equal(value.durationLabel, '1.0s');
});

test('whole messages interpolate safely and plural selection follows the locale', () => {
  assert.equal(translate('en', 'time.minutes', { count: 1 }), '1 minute');
  assert.equal(translate('en', 'time.minutes', { count: 2 }), '2 minutes');
  assert.equal(translate('zh-CN', 'time.minutes', { count: 2 }), '2 分钟');
  assert.equal(translate('en', 'sidebar.createInWorkspace', { name: '<script>中文</script>' }), 'New session in <script>中文</script>');
  assert.throws(() => translate('en', 'sidebar.createInWorkspace'), /Missing translation parameter/);
  assert.throws(() => translate('en', 'time.minutes'), /plural count/);
  assert.throws(() => translate('en', 'toString'), /Unknown translation key/);
});

test('localized visual metadata preserves theme IDs, tokens, palettes and external package labels', () => {
  const tokens = { '--accent': 'blue' };
  const kit = { id: 'material3', label: 'Aibo', description: '原文', themes: [{ id: 'forest-dark', label: '原文', colorScheme: 'dark', tokens, palette: { id: 'forest', label: '原文', description: '原文' } }] };
  const localized = localizeUiKit(kit, 'en');
  assert.equal(localized.id, kit.id);
  assert.equal(localized.themes[0].id, kit.themes[0].id);
  assert.equal(localized.themes[0].label, 'Forest green · Dark');
  assert.equal(localized.themes[0].tokens, tokens);
  assert.equal(localized.themes[0].palette.id, 'forest');
  assert.equal(kit.themes[0].label, '原文');
  const external = { ...kit, id: 'third.party' };
  assert.equal(localizeUiKit(external, 'en'), external);
});

test('search categories, confirmation policies and execution history localize their labels without changing identity', () => {
  assert.equal(localizedSearchKindLabels('en').file, 'Files');
  assert.equal(localizedSearchKindLabels('zh-CN').file, '文件');
  const zh = localizedHostConfirmationCategories('zh-CN');
  const en = localizedHostConfirmationCategories('en');
  assert.deepEqual(en.map(item => item.id), zh.map(item => item.id));
  assert.equal(en[0].label, 'Git operations');
  assert.equal(capabilityScopeLabel({scope:{kind:'workspace',id:'w'},label:'用户目录'}, 'en'), 'Workspace · 用户目录');
  assert.equal(executionStatus({status:'outcome_unknown'}, 'en'), 'Outcome unknown; check the actual changes');
  assert.equal(executionStatus({status:'running',stopRequested:true}, 'en'), 'Stop requested');
  assert.equal(executionStatus({status:'third-party-status'}, 'en'), 'third-party-status');
});


test('host message descriptors localize at display time and retain original parameters', () => {
  const params = {agent:'插件原名',tool:'原始命令'};
  const value = localizedMessage('activity.executing',params);
  params.tool = 'changed';
  assert.equal(translateMessage('en',value),'插件原名 is running 原始命令…');
  assert.equal(translateMessage('zh-CN',value),'插件原名 正在执行 原始命令…');
  assert.equal(translateMessage('en','用户原文'),'用户原文');
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.params));
  assert.throws(()=>localizedMessage('missing.message'),/Unknown translation key/);
});

test('localized host errors retain their key while raw errors remain unchanged', async () => {
  const {LocalizedError,toErrorText,toErrorMessage} = await import('../src/lib/app/error-utils.ts');
  const error = new LocalizedError('message.invalidAttachments',{paths:'/用户目录/原文件.png'});
  const state = toErrorText(error);
  assert.equal(state.key,'message.invalidAttachments');
  assert.equal(translateMessage('en',state),'Attachments have changed or are unavailable: /用户目录/原文件.png');
  assert.equal(translateMessage('zh-CN',state),'附件已变化或不可用：/用户目录/原文件.png');
  assert.equal(toErrorText(Error('插件原始错误')),'插件原始错误');
  assert.equal(toErrorText('原始字符串'),'原始字符串');
  assert.equal(translateMessage('en',toErrorText(undefined)),'The operation failed. Check the diagnostic log.');
  assert.equal(toErrorMessage(error,'zh-CN'),translateMessage('zh-CN',state));
});


test('nested host errors and original path lists resolve in the current locale', () => {
  const value = localizedMessage('execution.readTasksFailed',{error:localizedMessage('error.operationFailed')});
  assert.equal(translateMessage('en',value),'Failed to read project task records: The operation failed. Check the diagnostic log.');
  assert.equal(translateMessage('zh-CN',value),'工程任务记录读取失败：操作失败，请查看诊断日志。');
  const paths = ['/原目录/文件一.png','/原目录/文件二.png'];
  const list = localizedList(paths);
  paths.push('later');
  for (const locale of ['zh-CN','en']) {
    assert.equal(translateMessage(locale,localizedMessage('message.unsupportedImages',{paths:list})),translate(locale,'message.unsupportedImages',{paths:new Intl.ListFormat(locale).format(list.items)}));
  }
  assert.ok(Object.isFrozen(list.items));
});
