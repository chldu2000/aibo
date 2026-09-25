<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';
  import type { UiIconName } from '../../contract';

  let { name, size = 18, ...rest }: Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> & {
    name: UiIconName; size?: number;
  } = $props();

  // Material 3 rounded command artwork; independent of the ak-ui icon adapter.
  const paths: Record<UiIconName, string> = {
    add: 'M12 5v14M5 12h14',
    archive: 'M3 4h18v4H3ZM5 8v13h14V8M9 12h6',
    'archive-restore': 'M3 4h18v4H3ZM5 8v13h14V8M12 18v-7m-3 3 3-3 3 3',
    branch: 'M6 7v10m12-10c0 7-12 3-12 9M8 5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M8 19a2 2 0 1 1-4 0 2 2 0 1 1 4 0M20 5a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
    bolt: 'm13 3-9 11h7l-1 7 10-12h-7Z',
    terminal: 'M3 4h18v16H3Zm4 5 3 3-3 3m5 0h5',
    check: 'm5 12 4 4L19 6',
    'chevron-down': 'm6 9 6 6 6-6',
    close: 'm6 6 12 12M6 18 18 6',
    delete: 'M4 6h16M9 6V3h6v3M6 6v15h12V6M10 10v7m4-7v7',
    diagnostics: 'M3 12h4l3-8 4 16 3-8h4',
    edit: 'm4 16 12-12 4 4L8 20H4Zm9-9 4 4',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
    'shield-question': 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM9.5 9a2.5 2.5 0 1 1 4 2l-1.5 1v1m0 3h.01',
    'shield-alert': 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM12 8v5m0 3h.01',
    filter: 'M4 6h16M7 12h10m-7 6h4',
    file: 'M5 3h9l5 5v13H5ZM14 3v6h5M9 13h6m-6 4h6',
    focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    folder: 'M3 7V5h6l2 3h10v12H3Z',
    'folder-add': 'M3 7V5h6l2 3h10v12H3ZM12 11v6m-3-3h6',
    'panel-right': 'M3 4h18v16H3ZM15 4v16',
    plugins: 'M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Zm10 0h6v6h-6Z',
    refresh: 'M20 9a8 8 0 0 0-14-3L3 9m0-5v5h5M4 15a8 8 0 0 0 14 3l3-3m0 5v-5h-5',
    review: 'M5 3h9l5 5v4M5 3v18h6M14 3v6h5M19 16a3 3 0 1 1-6 0 3 3 0 1 1 6 0m-1 2 3 3',
    search: 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 1 1 13 0m-1 5.5 5 5',
    send: 'M12 19V5m-6 6 6-6 6 6',
    settings: 'M4 7h16M4 17h16M10 7a3 3 0 1 1-6 0 3 3 0 1 1 6 0M20 17a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
    pause: 'M7 5h3v14H7Zm7 0h3v14h-3Z',
    play: 'm7 4 13 8-13 8Z',
    stop: 'M6 6h12v12H6Z',
    trust: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
    undo: 'M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12',
    untrust: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-3 6 6 6m0-6-6 6',
    'window-maximize': 'M4 4h16v16H4Z',
    'window-minimize': 'M5 12h14',
  };
</script>

<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-material-icon={name} {...rest}>
  <path d={paths[name]} />
</svg>

<style>
  svg { flex: none; vertical-align: middle; }
</style>
