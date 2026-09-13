export type PresentationLayout = {
  navigation: { width: number; min: number; max: number };
  auxiliary: { width: number; min: number; max: number };
  auxiliaryOpen: boolean;
};
export type PresentationLayoutAction = {
  token: string;
  operation: 'resize';
  event: 'input';
  args: readonly ('navigation' | 'auxiliary')[];
};
