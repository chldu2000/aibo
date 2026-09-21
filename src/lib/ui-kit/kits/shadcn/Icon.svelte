<script lang="ts">
  import EyeIcon from '@lucide/svelte/icons/eye';
  import ShieldQuestionIcon from '@lucide/svelte/icons/shield-question-mark';
  import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/circle-play';
  import AddIcon from '@lucide/svelte/icons/plus';
  import ArchiveIcon from '@lucide/svelte/icons/archive';
  import ArchiveRestoreIcon from '@lucide/svelte/icons/archive-restore';
  import BranchIcon from '@lucide/svelte/icons/git-branch';
  import BoltIcon from '@lucide/svelte/icons/zap';
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
  import PluginsIcon from '@lucide/svelte/icons/puzzle';
  import SendIcon from '@lucide/svelte/icons/send';
  import SettingsIcon from '@lucide/svelte/icons/settings-2';
  import StopIcon from '@lucide/svelte/icons/square';
  import TrustIcon from '@lucide/svelte/icons/shield-check';
  import UndoIcon from '@lucide/svelte/icons/undo-2';
  import UntrustIcon from '@lucide/svelte/icons/shield-off';
  import WindowMaximizeIcon from '@lucide/svelte/icons/maximize';
  import WindowMinimizeIcon from '@lucide/svelte/icons/minus';
  import type { SVGAttributes } from 'svelte/elements';
  import type { UiIconName } from '../../contract';

  type IconProps = Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height'> & {
    name: UiIconName;
    size?: number;
  };

  let { name, size = 16, ...restProps }: IconProps = $props();

  const icons = {
    eye: EyeIcon,
    'shield-question': ShieldQuestionIcon,
    'shield-alert': ShieldAlertIcon,
    add: AddIcon,
    archive: ArchiveIcon,
    'archive-restore': ArchiveRestoreIcon,
    branch: BranchIcon,
    bolt: BoltIcon,
    check: CheckIcon,
    'chevron-down': ChevronDownIcon,
    close: CloseIcon,
    delete: DeleteIcon,
    diagnostics: DiagnosticsIcon,
    edit: EditIcon,
    filter: FilterIcon,
    file: FileIcon,
    focus: WindowMaximizeIcon,
    folder: FolderIcon,
    'folder-add': FolderAddIcon,
    refresh: RefreshIcon,
    review: ReviewIcon,
    search: SearchIcon,
    'panel-right': PanelRightIcon,
    plugins: PluginsIcon,
    send: SendIcon,
    settings: SettingsIcon,
    pause: PauseIcon,
    play: PlayIcon,
    stop: StopIcon,
    trust: TrustIcon,
    undo: UndoIcon,
    untrust: UntrustIcon,
    'window-maximize': WindowMaximizeIcon,
    'window-minimize': WindowMinimizeIcon,
  };

  const IconComponent = $derived(icons[name]);
  const defaultFill = $derived(name === 'stop' ? 'currentColor' : 'none');
</script>

<IconComponent {size} fill={defaultFill} {...restProps} />
