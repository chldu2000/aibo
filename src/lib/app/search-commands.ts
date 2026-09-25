export type SearchCommand = {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
};
