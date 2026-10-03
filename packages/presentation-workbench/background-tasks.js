export const backgroundTaskLabels = {running:'运行中',completed:'已完成',failed:'失败',stopped:'已停止',unknown:'状态未知'};
export function parseBackgroundTask(item) {
  if (item.toolName !== 'background_task') return null;
  try {
    const task = JSON.parse(item.content);
    if (!task || !['id','rootTurnId','name','command','activity'].every(key => typeof task[key] === 'string') || !Object.hasOwn(backgroundTaskLabels, task.status)) return null;
    if (task.status === 'running' && item.status !== 'streaming') return {...task,status:'unknown',activity:'连接已中断，无法确认任务是否仍在运行。'};
    return task;
  } catch { return null; }
}
