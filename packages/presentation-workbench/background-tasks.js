import {presentationTranslator} from './i18n.js';
export const backgroundTaskLabels = {running:'运行中',completed:'已完成',failed:'失败',stopped:'已停止',unknown:'状态未知'};
export function parseBackgroundTask(item,locale='zh-CN') {
  if (item.toolName !== 'background_task') return null;
  try {
    const task = JSON.parse(item.content);
    if (!task || !['id','rootTurnId','name','command','activity'].every(key => typeof task[key] === 'string') || !Object.hasOwn(backgroundTaskLabels, task.status)) return null;
    if (task.status === 'running' && item.status !== 'streaming') return {...task,status:'unknown',activity:presentationTranslator(locale)('background.disconnected')};
    return task;
  } catch { return null; }
}
