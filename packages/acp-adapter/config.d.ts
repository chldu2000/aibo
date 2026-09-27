export type AcpSelectOption = { value: string; name?: string; description?: string; tokens?: number };
export declare function selectValues(config: unknown): AcpSelectOption[];
export declare function modelParameters(configs: readonly unknown[], model: string | undefined): {
  levels: { id: string; label: string; values: { id: string; value: string }[] }[];
  current: string | null;
  context: { id: string; currentValue: string } | null;
  contextWindows: { id: string; label: string; description?: string; tokens?: number }[];
};
