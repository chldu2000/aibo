<script lang="ts">
  import AddIcon from '@lucide/svelte/icons/plus';
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
  import BranchIcon from '@lucide/svelte/icons/git-branch';
  import CheckIcon from '@lucide/svelte/icons/check';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import CloseIcon from '@lucide/svelte/icons/x';
  import DeleteIcon from '@lucide/svelte/icons/trash-2';
  import DiagnosticsIcon from '@lucide/svelte/icons/activity';
  import EditIcon from '@lucide/svelte/icons/pencil';
  import FilterIcon from '@lucide/svelte/icons/list-filter';
  import FileIcon from '@lucide/svelte/icons/file';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import FolderAddIcon from '@lucide/svelte/icons/folder-plus';
  import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
  import ReviewIcon from '@lucide/svelte/icons/file-search';
  import SearchIcon from '@lucide/svelte/icons/search';
  import PanelRightIcon from '@lucide/svelte/icons/panel-right';
  import SendIcon from '@lucide/svelte/icons/send';
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import StopIcon from '@lucide/svelte/icons/square';
  import TerminalIcon from '@lucide/svelte/icons/terminal';
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
    diagnostics: DiagnosticsIcon,
    edit: EditIcon,
    filter: FilterIcon,
    file: FileIcon,
    folder: FolderIcon,
    'folder-add': FolderAddIcon,
    refresh: RefreshIcon,
    review: ReviewIcon,
    search: SearchIcon,
    'panel-right': PanelRightIcon,
    send: SendIcon,
    settings: SettingsIcon,
    stop: StopIcon,
    terminal: TerminalIcon,
    trust: TrustIcon,
    undo: UndoIcon,
    untrust: UntrustIcon,
  };

  const IconComponent = $derived(icons[name]);
  const defaultFill = $derived(name === 'stop' ? 'currentColor' : 'none');
</script>

<IconComponent {size} fill={defaultFill} {...restProps} />
