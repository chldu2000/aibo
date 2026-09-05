export type CommandPaletteCommand = {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
};
