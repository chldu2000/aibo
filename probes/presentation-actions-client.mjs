// Exercise host commands even when a management page suspends the workbench.
import { tick } from 'svelte';
export async function togglePresentationFocus() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
  await tick();
  const command = [...document.querySelectorAll('[role="option"]')].find(node => node.textContent.includes('切换专注会话'));
  if (!command) throw Error('Host focus command is unavailable');
  command.click();
  await tick();
}
export function restorePresentation() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', ctrlKey: true, shiftKey: true, bubbles: true }));
}
export async function swapPresentationNavigation() {
  document.querySelector('button[aria-label="打开设置"]').click();
  await tick();
  document.querySelector('button[aria-label="交换工作台侧边区域"]').click();
  await tick();
  document.querySelector('button[aria-label="关闭设置"]').click();
  await tick();
}
