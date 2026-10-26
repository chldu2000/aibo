export { boundedRecovery } from './recovery-state.mjs';
import { createHash } from 'node:crypto';
import { RecoveryStateStore, recoveryError } from './recovery-state.mjs';
/** Bounded provider-owned snapshots. Absence of a process is never evidence of success. */
export class BackgroundTasks {
  tasks = new Map();
  configureStorage(root, owner) { this.store = new RecoveryStateStore(root, owner); }
  checkpoint() {
    if (!this.store) return this.list(); // Direct SDK consumers retain the legacy in-memory API.
    return this.store.save(this.list());
  }
  update(update, rootTurnId) {
    if (typeof update.id !== 'string' || !update.id) return;
    const old = this.tasks.get(update.id);
    if (!old && !rootTurnId) return;
    const next = { id: update.id, rootTurnId: old?.rootTurnId ?? rootTurnId,
      name: '后台命令', command: '', status: 'running', activity: '', ...old, ...update };
    next.rootTurnId = old?.rootTurnId ?? rootTurnId;
    for (const key of ['id', 'rootTurnId', 'name', 'command', 'activity', 'outputPath']) {
      if (next[key] !== undefined) next[key] = Array.from(String(next[key])).slice(0, key === 'activity' ? 12000 : 4000).join('');
    }
    // Full output keeps its newest end; `activity` stays the short summary shown without expanding.
    if (next.output !== undefined) next.output = Array.from(String(next.output)).slice(-12000).join('');
    if (!['running','completed','failed','stopped','unknown'].includes(next.status)) next.status = 'unknown';
    // Late start/progress messages cannot revive a task with an observed terminal state.
    if (old && ['completed','failed','stopped'].includes(old.status) && ['running','unknown'].includes(next.status)) next.status = old.status;
    if (!old && this.tasks.size >= 128) {
      const evict = [...this.tasks.values()].find(task => ['completed','failed','stopped'].includes(task.status));
      if (!evict) throw recoveryError('recovery_state_write_failed');
      this.tasks.delete(evict.id);
    }
    this.tasks.set(next.id, next);
  }
  page(cursor) {
    const tasks=[]; let bytes=0, nextCursor=null;
    const ordered=this.list().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).filter(task=>!cursor || task.id>cursor);
    for (const task of ordered) {
      const {output, ...summary}=task;
      summary.name=Array.from(summary.name).slice(0,64).join('');summary.command=Array.from(summary.command).slice(0,256).join('');summary.activity=Array.from(summary.activity).slice(-256).join('');
      if(summary.outputPath) summary.outputPath=Array.from(summary.outputPath).slice(0,256).join('');
      const size=Buffer.byteLength(JSON.stringify(summary))+1;
      if (tasks.length && bytes+size>65536) {nextCursor=tasks.at(-1).id;break;}
      if (size>65536) throw recoveryError('recovery_state_corrupt');
      bytes+=size; tasks.push(summary);
    }
    return {tasks,nextCursor};
  }
  read({taskId,cursor=0,revision}) {
    const task=this.tasks.get(taskId);
    if(!task) throw Object.assign(new Error('Background task is unavailable'),{kind:'invalid_input'});
    const output=task.output??task.activity, digest=createHash('sha256').update(output).digest('hex');
    if (revision && revision!==digest) throw Object.assign(new Error('Background output changed; read again'),{kind:'busy'});
    const chars=Array.from(output);
    if(!Number.isSafeInteger(cursor)||cursor<0||cursor>chars.length) throw Object.assign(new Error('Invalid output cursor'),{kind:'invalid_input'});
    return {output:chars.slice(cursor,cursor+4096).join(''),nextCursor:cursor+4096<chars.length?cursor+4096:null,revision:digest,truncated:chars.length>=12000};
  }
  list() { return [...this.tasks.values()].map(task => ({ ...task })); }
  restore(tasks) {
    if (tasks && !Array.isArray(tasks)) {
      if (!this.store) throw recoveryError('recovery_state_missing');
      tasks = this.store.load(tasks);
    }
    if (tasks != null && (!Array.isArray(tasks) || tasks.length > 128 || tasks.some(task => !task || typeof task.id !== 'string' || typeof task.rootTurnId !== 'string'))) throw recoveryError('recovery_state_corrupt');
    this.tasks.clear();
    for (const task of (tasks ?? [])) {
      this.update({ ...task, ...(task.status === 'running' ? {status:'unknown', activity:'连接已重建，等待原生任务状态确认。'} : {}) }, task.rootTurnId);
    }
  }
  unavailable(message) {
    for (const task of this.tasks.values()) if (task.status === 'running') this.update({id:task.id,status:'unknown',activity:message});
  }
}
