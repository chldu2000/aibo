<script lang="ts">
  import AddIcon from '@lucide/svelte/icons/plus';
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
  import BranchIcon from '@lucide/svelte/icons/git-branch';
  import CheckIcon from '@lucide/svelte/icons/check';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import CloseIcon from '@lucide/svelte/icons/x';
  import DeleteIcon from '@lucide/svelte/icons/trash-2';
  import EditIcon from '@lucide/svelte/icons/pencil';
  import FilterIcon from '@lucide/svelte/icons/list-filter';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import FolderAddIcon from '@lucide/svelte/icons/folder-plus';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import SearchIcon from '@lucide/svelte/icons/search';
  import SendIcon from '@lucide/svelte/icons/send';
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import StopIcon from '@lucide/svelte/icons/square';
  import TrustIcon from '@lucide/svelte/icons/shield-check';
  import UndoIcon from '@lucide/svelte/icons/undo-2';
  import UntrustIcon from '@lucide/svelte/icons/shield-off';
  import type { SVGAttributes } from 'svelte/elements';
  import type { UiIconName } from '../../contract';

  type IconProps = Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> & {
    name: UiIconName;
    size?: number;
  };

  let { name, size = 16, ...restProps }: IconProps = $props();

  const icons = {
    add: AddIcon,
    archive: ArchiveIcon,
    'archive-restore': ArchiveRestoreIcon,
    branch: BranchIcon,
    check: CheckIcon,
    'chevron-down': ChevronDownIcon,
    close: CloseIcon,
    delete: DeleteIcon,
    edit: EditIcon,
    filter: FilterIcon,
    folder: FolderIcon,
    'folder-add': FolderAddIcon,
    refresh: RefreshIcon,
    search: SearchIcon,
    send: SendIcon,
    settings: SettingsIcon,
    stop: StopIcon,
    trust: TrustIcon,
    undo: UndoIcon,
    untrust: UntrustIcon,
  };

  const IconComponent = $derived(icons[name]);
  const defaultFill = $derived(name === 'stop' ? 'currentColor' : 'none');
</script>

<IconComponent {size} fill={defaultFill} {...restProps} />
