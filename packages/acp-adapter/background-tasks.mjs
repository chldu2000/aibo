/** Bounded provider-owned snapshots. Absence of a process is never evidence of success. */
export class BackgroundTasks {
  tasks = new Map();
  update(update, rootTurnId) {
    if (typeof update.id !== 'string' || !update.id) return;
    const old = this.tasks.get(update.id);
    if (!old && !rootTurnId) return;
    const next = { id: update.id, rootTurnId: old?.rootTurnId ?? rootTurnId,
      name: '后台命令', command: '', status: 'running', activity: '', ...old, ...update };
    next.rootTurnId = old?.rootTurnId ?? rootTurnId;
    for (const key of ['id', 'rootTurnId', 'name', 'command', 'activity', 'outputPath']) {
      if (next[key] !== undefined) next[key] = String(next[key]).slice(0, key === 'activity' ? 12000 : 4000);
    }
    if (!['running','completed','failed','stopped','unknown'].includes(next.status)) next.status = 'unknown';
    // Late start/progress messages cannot revive a task with an observed terminal state.
    if (old && ['completed','failed','stopped'].includes(old.status) && ['running','unknown'].includes(next.status)) next.status = old.status;
    if (!old && this.tasks.size >= 128) {
      const evict = [...this.tasks.values()].find(task => task.status !== 'running');
      if (!evict) throw new Error('Background task limit exceeded');
      this.tasks.delete(evict.id);
    }
    this.tasks.set(next.id, next);
  }
  list() { return [...this.tasks.values()].map(task => ({ ...task })); }
  restore(tasks) {
    this.tasks.clear();
    for (const task of (Array.isArray(tasks) ? tasks : []).slice(-128)) {
      this.update({ ...task, ...(task.status === 'running' ? {status:'unknown', activity:'连接已重建，等待原生任务状态确认。'} : {}) }, task.rootTurnId);
    }
  }
  unavailable(message) {
    for (const task of this.tasks.values()) if (task.status === 'running') this.update({id:task.id,status:'unknown',activity:message});
  }
}
