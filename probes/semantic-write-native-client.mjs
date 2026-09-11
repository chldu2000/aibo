import '/src/app.css';
import * as api from '../src/lib/api';
import { mount, unmount, tick } from 'svelte';
import { setUiKit } from '/src/lib/ui-kit/registry.ts';
import InstalledWorkbench from '/src/lib/workbench/InstalledWorkbench.svelte';
const post = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) });
const check = (condition, label) => { if (!condition) throw Error(label); };
async function until(read, label) {
  const end = Date.now() + 20000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw Error(label);
}
try {
  const config = await (await fetch('/__write_config')).json();
  const workspace = await api.addWorkspace(config.workspacePath);
  await api.setWorkspaceTrust(workspace.id, true);
  const plugin = await api.installAgentPlugin(config.packagePath); await api.setAgentPluginEnabled(plugin.id, true);
  const contribution = (await api.listSemanticContributions()).find(item => item.installationId === plugin.id);
  check(contribution?.available, 'installed contribution available');
  const results = [];
  for (const kit of ['shadcn', 'material3']) {
    setUiKit(kit); document.body.dataset.uiKit = kit;
    let writes = 0, finished = false;
    const port = { open: api.openSemanticContribution, cancelOpen: api.cancelSemanticOpen, act: api.actSemanticContribution, release: api.releaseSemanticContribution,
      write: async (...args) => { writes++; const result = await api.writeSemanticContribution(...args); finished = true; return result; } };
    const component = mount(InstalledWorkbench, { target: document.getElementById('probe'), props: { workspaceId: workspace.id, contribution, port, onClose: () => {} } });
    await tick();
    const button = await until(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('写入样例') && !button.disabled), 'write action visible');
    await post('/__write_approval', { marker: 'semantic-write', decision: '允许本次执行' });
    button.click(); button.click();
    await until(() => finished, 'native write completed');
    await until(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('写入样例') && !button.disabled), 'refreshed write view');
    check(writes === 1, 'repeated click issued one request');
    await until(() => document.querySelector('textarea')?.value.includes('semantic-write'), 'refreshed result displayed');
    const rows = await api.listWorkspaceWriteRuns(workspace.id);
    check(rows.length === results.length + 1 && rows.every(row => row.operation === 'semantic.write' && row.status === 'completed'), 'durable semantic write history');
    results.push({ kit, actualButton: true, nativeApproved: true, duplicateSuppressed: true, refreshedResult: true });
    await unmount(component);
  }
  await post('/__write_report', { ok: true, results });
} catch (error) { await post('/__write_report', { ok: false, error: String(error) }); }
