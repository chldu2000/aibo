<script lang="ts">
  import add from '@ktibow/iconset-material-symbols/add-rounded';
  import archive from '@ktibow/iconset-material-symbols/archive-outline-rounded';
  import archiveRestore from '@ktibow/iconset-material-symbols/unarchive-outline-rounded';
  import branch from '@ktibow/iconset-material-symbols/account-tree-outline-rounded';
  import check from '@ktibow/iconset-material-symbols/check-rounded';
  import chevronDown from '@ktibow/iconset-material-symbols/keyboard-arrow-down-rounded';
  import close from '@ktibow/iconset-material-symbols/close-rounded';
  import remove from '@ktibow/iconset-material-symbols/delete-outline-rounded';
  import edit from '@ktibow/iconset-material-symbols/edit-outline-rounded';
  import filter from '@ktibow/iconset-material-symbols/filter-list-rounded';
  import folder from '@ktibow/iconset-material-symbols/folder-outline-rounded';
  import folderAdd from '@ktibow/iconset-material-symbols/create-new-folder-outline-rounded';
  import refresh from '@ktibow/iconset-material-symbols/refresh-rounded';
  import search from '@ktibow/iconset-material-symbols/search-rounded';
  import send from '@ktibow/iconset-material-symbols/send-rounded';
  import settings from '@ktibow/iconset-material-symbols/tune-rounded';
  import stop from '@ktibow/iconset-material-symbols/stop-rounded';
  import terminal from '@ktibow/iconset-material-symbols/terminal-rounded';
  import trust from '@ktibow/iconset-material-symbols/verified-user-outline-rounded';
  import undo from '@ktibow/iconset-material-symbols/undo-rounded';
  import untrust from '@ktibow/iconset-material-symbols/gpp-bad-outline-rounded';
  import { Icon as MaterialIcon } from 'm3-svelte';
  import type { SVGAttributes } from 'svelte/elements';
  import type { UiIconName } from '../../contract';

  type IconProps = Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> & {
    name: UiIconName;
    size?: number;
  };

  let { name, size = 18, ...restProps }: IconProps = $props();

  const icons = {
    add,
    archive,
    'archive-restore': archiveRestore,
    branch,
    check,
    'chevron-down': chevronDown,
    close,
    delete: remove,
    edit,
    filter,
    folder,
    'folder-add': folderAdd,
    refresh,
    search,
    send,
    settings,
    stop,
    terminal,
    trust,
    undo,
    untrust,
  };
</script>

<MaterialIcon icon={icons[name]} {size} {...restProps} />
