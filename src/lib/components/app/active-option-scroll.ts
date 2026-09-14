export function scrollActiveOptionIntoView(container: HTMLElement | null): void {
  container
    ?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    ?.scrollIntoView({ block: 'nearest' });
}
