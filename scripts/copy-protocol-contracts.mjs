// Copies the host contracts into @aibolabs/plugin-protocol before packing, so plugin repositories can
// validate manifests and operation schemas without a host checkout. contracts/ stays the only source.
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../contracts/', import.meta.url));
const target = fileURLToPath(new URL('../packages/plugin-protocol/contracts/', import.meta.url));
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true, filter: file => file === source || file.endsWith('.json') });
