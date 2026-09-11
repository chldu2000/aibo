import '/src/app.css';
import { invoke } from '@tauri-apps/api/core';
import { mount, tick } from 'svelte';
import App from '/src/App.svelte';
import { setUiKit } from '/src/lib/ui-kit/registry.ts';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(find, label) { const end = Date.now() + 30000; while (Date.now() < end) { const value = await find(); if (value) return value; await delay(80); } throw Error(`timeout: ${label}`); }
const check = (value, label) => { if (!value) throw Error(label); };
const report = value => fetch('/__git_report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
try {
  const config = await (await fetch('/__git_config')).json(); let saved = config.saved;
  if (config.stage === 0) {
    const workspace = await invoke('add_workspace', { path: config.workspacePath }); await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
    const git = await invoke('install_agent_plugin', { path: config.gitPath }); await invoke('set_agent_plugin_enabled', { id: git.id, enabled: true });
    const view = await invoke('install_agent_plugin', { path: config.viewPath }); await invoke('set_agent_plugin_enabled', { id: view.id, enabled: true });
    const catalogPackage = await invoke('install_agent_plugin', {path: config.catalogPath}); await invoke('set_agent_plugin_enabled',{id:catalogPackage.id,enabled:true});
    saved = { catalogId:catalogPackage.id, workspaceId: workspace.id, gitId: git.id, viewId: view.id };
    await invoke('bind_capability_provider', { binding: { scope: { kind: 'workspace', id: workspace.id }, capability: 'dev.aibo.git.changes', version: '1.0.0', installationId: git.id, contributionId: 'dev.aibo.git.read' } });
  }
  // Before mounting App or its Git UI, execute the real installed capability.
  const output = await invoke('invoke_capability', { request: { scope: { kind: 'workspace', id: saved.workspaceId }, capability: 'dev.aibo.git.changes', version: '1.0.0', requestId: `native-${config.stage}`, input: {} } });
  check(output.output.items.some(item => item.path === 'native.txt'), 'background Git query');
  mount(App, { target: document.getElementById('app') });
  const workspaceButton = await until(() => document.querySelector('button[aria-label="workspace，可信"]'), 'workspace loaded'); workspaceButton.click();
  for (const kit of ['shadcn', 'material3']) {
    setUiKit(kit); await tick();
    const titlebar = document.querySelector('[data-ui-component="window-titlebar"]');
    button('插件').click();
    const management = await until(() => document.querySelector('.host-plugin-region .plugin-workspace'), 'independent plugin management');
    check(!management.closest('.workbench-presentation'), 'management is host owned');
    document.querySelector('button[aria-label="切换工作台呈现"]').click();
    await until(() => document.querySelector('[data-presentation-layout="focus"]'), 'switch with host management open');
    check(document.querySelector('.host-plugin-region .plugin-workspace') === management, 'management survives layout remount');
    check(document.querySelector('[data-ui-component="window-titlebar"]') === titlebar, 'window controls survive layout remount');
    document.querySelector('button[aria-label="恢复默认呈现"]').click();
    await until(() => document.querySelector('[data-presentation-layout="standard"]'), 'restore with management open');
    check(document.querySelector('.host-plugin-region .plugin-workspace') === management, 'management survives recovery');
    button('返回会话').click();
    await until(() => !document.querySelector('.host-plugin-region'), 'return to workbench');
  }
  const rendered = [];
  for (const [kit, title] of [['shadcn', 'Git 工作区变更'], ['material3', 'Git 工作区变更'], ['material3', 'Git 变更（独立声明包）']]) {
    setUiKit(kit); await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    const entry = await until(() => [...document.querySelectorAll('[role="option"]')].find(item => item.querySelector('strong')?.textContent === title && !item.disabled), 'installed command: ' + title);
    entry.click();
    const inspect = await until(() => document.querySelector('button[aria-label="查看差异 native.txt"]') ?? document.querySelector('textarea[aria-label="文件差异内容"]'), 'installed collection or restored detail'); if (inspect.tagName === 'BUTTON') inspect.click();
    await until(() => document.querySelector('textarea[aria-label="文件差异内容"]')?.value.includes('NATIVE_GIT_PLUGIN_OK'), 'installed diff');
    rendered.push({ kit, title, commandDiscovered: true, collection: true, realDiff: true });
    if (title.includes('独立')) {
      await invoke('set_agent_plugin_enabled', { id: saved.viewId, enabled: false });
      await until(() => !document.querySelector('section.installed-workbench'), 'disabled view removed');
      await invoke('set_agent_plugin_enabled', { id: saved.viewId, enabled: true });
    } else { button('返回变更列表').click(); await until(() => document.querySelector('button[aria-label="查看差异 native.txt"]'), 'back'); button('关闭插件视图').click(); await until(() => !document.querySelector('section.installed-workbench'), 'close'); }
  }
  const catalogViews=[];
  for (const kit of ['shadcn','material3']) for (const name of ['settings','tool','command']) {
    setUiKit(kit);await tick();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}));
    const entry=await until(()=>[...document.querySelectorAll('[role="option"]')].find(item=>item.querySelector('strong')?.textContent==='Catalog '+name&&!item.disabled),'catalog command '+name);
    entry.click();
    await until(()=>document.querySelector('section.installed-workbench textarea')?.value==='CATALOG_OK','catalog view '+name);
    button('刷新').click();
    await until(()=>document.querySelector('section.installed-workbench textarea')?.value==='CATALOG_OK','refreshed catalog');
    catalogViews.push({kit,name,installed:true,rendered:true});
    button('关闭插件视图').click();await until(()=>!document.querySelector('section.installed-workbench'),'close catalog');
  }
  const catalog=await invoke('list_semantic_contributions');
  check(catalog.find(item=>item.contributionId==='dev.aibo.catalog.future')?.available===false,'optional unsupported contribution diagnosed');
  if (config.stage === 1) {
    await invoke('uninstall_agent_plugin', { id: saved.gitId });
    const catalog = await invoke('list_semantic_contributions');
    check(catalog.every(item => item.installationId !== saved.gitId), 'uninstalled bundled contribution absent');
    check(catalog.find(item => item.installationId === saved.viewId)?.available === false, 'separate view reports missing dependency');
  }
  if(config.stage===0) await invoke('set_agent_plugin_enabled',{id:saved.gitId,enabled:false});
  await invoke('set_workspace_trust',{workspaceId:saved.workspaceId,trusted:false});
  const auditScope={kind:'workspace',id:saved.workspaceId};
  let audit=await invoke('read_capability_history',{scope:auditScope,before:null});
  for(let count=0;count<20&&!audit.events.some(event=>event.payload.invocationId===output.invocationId&&event.payload.status==='completed')&&audit.nextBefore;count++) audit=await invoke('read_capability_history',{scope:auditScope,before:audit.nextBefore});
  check(audit.events.some(event=>event.payload.invocationId===output.invocationId&&event.payload.status==='completed'),'persisted completed capability audit');
  const scopePage=await invoke('list_capability_history_scopes',{before:null});
  check(scopePage.items.some(item=>item.scope.kind==='workspace'&&item.scope.id===saved.workspaceId),'audit catalog survives trust revocation');
  for(const kit of ['shadcn','material3']) {
    setUiKit(kit);await tick();button('执行历史').click();
    (await until(()=>button('插件调用历史'),'audit entry')).click();
    const panel=await until(()=>document.querySelector('.host-capability-history-region'),'independent audit region');
    check(!panel.closest('.workbench-presentation'),'audit is host owned');
    const scopeButton=await until(()=>[...document.querySelectorAll('nav[aria-label="调用历史作用域"] button')].find(item=>item.textContent.includes('工作区 · workspace')),'persisted audit scope');scopeButton.click();
    await tick();await until(()=>panel.querySelector('[data-ui-component="capability-history"]')?.getAttribute('aria-busy')==='false','audit page settled');
    for(let count=0;count<20&&![...panel.querySelectorAll('textarea')].some(item=>item.value.includes(output.invocationId));count++) {
      const older=[...panel.querySelectorAll('button')].find(item=>item.textContent.trim()==='更早记录');check(older&&!older.disabled,'older audit page exists');older.click();await tick();
      await until(()=>panel.querySelector('[data-ui-component="capability-history"]')?.getAttribute('aria-busy')==='false','older audit page settled');
    }
    check([...panel.querySelectorAll('textarea')].some(item=>item.value.includes(output.invocationId)),'audit renders real invocation');
    document.querySelector('button[aria-label="切换工作台呈现"]').click();
    await until(()=>document.querySelector('[data-presentation-layout="focus"][aria-busy="false"]'),'switch with audit open');
    check(document.querySelector('.host-capability-history-region')===panel,'audit survives renderer replacement');
    document.querySelector('button[aria-label="恢复默认呈现"]').click();
    await until(()=>document.querySelector('[data-presentation-layout="standard"][aria-busy="false"]'),'restore with audit open');
    check(document.querySelector('.host-capability-history-region')===panel,'audit survives recovery');
    button('返回执行历史').click();(await until(()=>button('返回工作台'),'return to execution history')).click();
  }
  await invoke('set_workspace_trust',{workspaceId:saved.workspaceId,trusted:true});
  if(config.stage===0) await invoke('set_agent_plugin_enabled',{id:saved.gitId,enabled:true});
  check((await invoke('list_sessions', { workspaceId: saved.workspaceId })).length === 0, 'no Agent session');
  await report({ ok: true, stage: config.stage, saved, evidence: { backgroundGitWithoutUi: true, independentCapabilityAuditBothSkins:true, auditReadableAfterRevocation:true, independentHostManagementBothSkins: true, installedCommands: rendered, catalogViews, optionalIncompatibilityDiagnosed:true, disablingViewClosesSurface: true, noAgentSession: true, ...(config.stage === 1 ? { actualAppRestart: true, persistedCapabilityBinding: true, uninstallInvalidatesBothForms: true } : {}) } });
} catch (error) { await report({ ok: false, surface: document.querySelector('section.installed-workbench')?.textContent, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }); }
