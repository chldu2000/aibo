// Host preload for explicitly opted-in Node ESM capability plugins.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('./loader.mjs', import.meta.url, {
  data: JSON.parse(readFileSync(new URL('./sdk.json', import.meta.url), 'utf8')),
});
