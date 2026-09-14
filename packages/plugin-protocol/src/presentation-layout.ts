export type PresentationLayout = {
  navigation: { width: number; min: number; max: number };
  auxiliary: { width: number; min: number; max: number };
  auxiliaryOpen: boolean;
  mode?: 'standard' | 'focus' | 'review';
  switching?: boolean;
};
export type PresentationLayoutAction = {
  token: string;
  operation: 'resize' | 'selectMode';
  event: 'input' | 'click';
  args: readonly ('navigation' | 'auxiliary' | 'standard' | 'focus' | 'review')[];
};
