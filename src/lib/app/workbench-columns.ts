export type ColumnFitInput = {
  /** Width left for both side columns after splitters and the minimum content column. */
  space: number;
  navigation: { width: number; min: number; collapsed: boolean; collapsedWidth: number };
  inspector: { width: number; min: number; open: boolean };
};

/**
 * Compresses the preferred side-column widths to fit the window without
 * changing the preferences themselves, so widening the window restores them.
 * Columns shrink in proportion to how far each sits above its minimum.
 */
export function fitColumnWidths({ space, navigation, inspector }: ColumnFitInput): { navigation: number; inspector: number } {
  const nav = navigation.collapsed ? navigation.collapsedWidth : navigation.width;
  const aux = inspector.open ? inspector.width : 0;
  const navSlack = navigation.collapsed ? 0 : Math.max(0, nav - navigation.min);
  const auxSlack = inspector.open ? Math.max(0, aux - inspector.min) : 0;
  const overflow = nav + aux - space;
  if (overflow <= 0 || navSlack + auxSlack === 0) return { navigation: nav, inspector: inspector.width };
  const ratio = Math.min(1, overflow / (navSlack + auxSlack));
  return {
    navigation: Math.round(nav - navSlack * ratio),
    inspector: inspector.open ? Math.round(aux - auxSlack * ratio) : inspector.width,
  };
}
