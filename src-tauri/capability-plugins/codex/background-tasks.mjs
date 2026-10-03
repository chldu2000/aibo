import { BackgroundTasks } from '@aibolabs/acp-adapter/background-tasks';

/** Correlate native terminal evidence before exposing a command as background work. */
export class CodexBackgroundTasks extends BackgroundTasks {
  commands = new Map();
  listSupported = true;
  observe(method, params, hostTurnId) {
    const item = params.item;
    if (item?.type === 'commandExecution') {
      const old = this.commands.get(item.id);
      if (!old && !hostTurnId) return;
      const command = { ...old, ...item, rootTurnId: old?.rootTurnId ?? hostTurnId };
      this.commands.set(item.id, command);
      if (this.tasks.has(item.id)) this.record(command);
      if (this.commands.size > 512) {
        const discard = [...this.commands.values()].find(value => value.status !== 'inProgress' && !this.tasks.has(value.id));
        if (discard) this.commands.delete(discard.id);
      }
    }
    if (method === 'item/commandExecution/terminalInteraction') {
      const command = this.commands.get(params.itemId);
      if (command) this.record(command);
    }
  }
  record(item) {
    this.update({ id:item.id, name:'后台命令', command:item.command ?? '',
      status:item.status === 'completed' ? (item.exitCode && item.exitCode !== 0 ? 'failed' : 'completed')
        : ['failed','declined'].includes(item.status) ? 'failed' : 'running',
      activity:item.aggregatedOutput ?? '', exitCode:item.exitCode ?? null }, item.rootTurnId);
  }
  turnEnded(rootTurnId) {
    for (const command of this.commands.values()) {
      if (command.rootTurnId === rootTurnId && command.status === 'inProgress' && command.processId) this.record(command);
    }
  }
  async refresh(rpc, threadId) {
    if (this.listSupported) {
      try {
        let cursor;
        for (let page = 0; page < 8; page++) {
          const result = await rpc('thread/backgroundTerminals/list', {threadId, limit:128, ...(cursor ? {cursor} : {})}, 5000);
          for (const terminal of result.data ?? []) {
            const command = this.commands.get(terminal.itemId);
            if (command) this.record({...command, status:'inProgress'});
          }
          cursor = result.nextCursor;
          if (!cursor) break;
        }
      } catch (error) {
        if (/method not found|unknown (method|variant)|unsupported.*method|not supported/i.test(error.message)) this.listSupported = false;
        else { this.unavailable('后台终端查询失败，等待重新确认。'); throw error; }
      }
    }
    // Also reconcile exit codes from the authoritative items. A missing item stays unknown.
    if (this.list().some(task => ['running','unknown'].includes(task.status))) {
      const result = await rpc('thread/read', {threadId, includeTurns:true}, 5000);
      for (const turn of result.thread?.turns ?? []) for (const item of turn.items ?? []) {
        if (item.type === 'commandExecution' && this.tasks.has(item.id)) {
          const task = this.tasks.get(item.id);
          // A replayed inProgress item is historical, not proof of a live process after restart.
          if (task.status === 'unknown' && item.status === 'inProgress') continue;
          this.record({...item, rootTurnId:task.rootTurnId});
        }
      }
    }
    return this.list();
  }
}
