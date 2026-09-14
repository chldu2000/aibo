import validate from './semantic-view-validator.js';
import type { Snapshot } from './contract.ts';
/** Validate before crossing the renderer seam, including provider-controlled strings. */
export function assertSnapshot(value: unknown): asserts value is Snapshot {
  if (!validate(value)) throw new Error('invalid_snapshot: schema');
  const snapshot = value as Snapshot;
  if (snapshot.context.contributionId !== snapshot.contribution.id) throw new Error('invalid_snapshot: contribution identity');
  const serialized = JSON.stringify(snapshot);
  if (snapshot.schema !== 'aibo.semantic-view/experimental-v1') {
    let bytes = 0;
    for (const character of serialized) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > 262_144) throw new Error('invalid_snapshot: size');
    }
  } else if (serialized.length > 1_000_000) throw new Error('invalid_snapshot: size');
  if (new Set(snapshot.actions.map(action => action.id)).size !== snapshot.actions.length) throw new Error('invalid_snapshot: duplicate action');
  if (snapshot.view.kind === 'collection') {
    const view = snapshot.view;
    if (new Set(view.items.map(item => item.id)).size !== view.items.length || new Set(view.properties.map(p => p.key)).size !== view.properties.length) throw new Error('invalid_snapshot: duplicate identity');
    for (const item of view.items) {
      if (Object.keys(item.values).length !== view.properties.length) throw new Error('invalid_snapshot: properties');
      for (const property of view.properties) {
        if (!Object.hasOwn(item.values, property.key) || (property.type === 'enum' && !property.values.includes(item.values[property.key]))) throw new Error('invalid_snapshot: property value');
      }
    }
    if (view.selection !== null && !view.items.some(item => item.id === view.selection)) throw new Error('invalid_snapshot: selection');
    if (view.page.offset + view.items.length > view.page.total) throw new Error('invalid_snapshot: page');
  }
}
