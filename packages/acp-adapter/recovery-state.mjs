import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import limits from './recovery-limits.mjs';

const MAX_OBJECT = 16 * 1024 * 1024;
const MAX_STORE = 64 * 1024 * 1024;
export const RECOVERY_ENTRY_BYTES = limits.entryBytes;
export function recoveryError(reason) {
  return Object.assign(new Error(reason), { kind: reason });
}
const hash = value => createHash('sha256').update(value).digest('hex');

/** Immutable, content-addressed revisions. No GC without host acknowledgement: old bindings remain readable. */
export class RecoveryStateStore {
  constructor(root, owner, { maxBytes = MAX_STORE } = {}) {
    if(typeof owner!=='string'||!owner) throw recoveryError('recovery_state_corrupt');
    this.root = root;
    this.owner = owner;
    this.maxBytes = maxBytes;
  }
  directory() {
    const root = fs.realpathSync(this.root);
    const dir = path.join(root, 'recovery-state-v1');
    try { fs.mkdirSync(dir, { mode: 0o700 }); const fd=fs.openSync(root,'r');try {fs.fsyncSync(fd);}finally{fs.closeSync(fd);} } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir) throw recoveryError('recovery_state_corrupt');
    return dir;
  }
  syncDirectory(dir) {
    const fd=fs.openSync(dir,'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  readObject(dir, digest) {
    const fd = fs.openSync(path.join(dir, digest + '.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_OBJECT) throw recoveryError('recovery_state_corrupt');
      const buffer=Buffer.alloc(stat.size+1);
      let length=0;
      while(length<buffer.length) {const count=fs.readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
      if(length!==stat.size) throw recoveryError('recovery_state_corrupt');
      const bytes=buffer.subarray(0,length);
      if (bytes.length > MAX_OBJECT || hash(bytes) !== digest) throw recoveryError('recovery_state_corrupt');
      const document = JSON.parse(bytes);
      if (document.version !== 1 || document.owner !== this.owner || !Object.hasOwn(document, 'data')) throw recoveryError('recovery_state_corrupt');
      return document.data;
    } finally { fs.closeSync(fd); }
  }
  load(reference) {
    if (reference?.schema !== 'aibo.private-state/v1' || !/^[a-f0-9]{64}$/.test(reference.digest ?? '')) throw recoveryError('recovery_state_corrupt');
    try { return this.readObject(this.directory(), reference.digest); }
    catch (error) {
      if (error.code === 'ENOENT') throw recoveryError('recovery_state_missing');
      throw recoveryError('recovery_state_corrupt');
    }
  }
  save(data) {
    let temporary;
    try {
      const bytes = Buffer.from(JSON.stringify({ version: 1, owner: this.owner, data }));
      if (bytes.length > MAX_OBJECT) throw recoveryError('recovery_state_write_failed');
      const digest = hash(bytes), dir = this.directory(), target = path.join(dir, digest + '.json');
      if (fs.existsSync(target)) { this.readObject(dir, digest); this.syncDirectory(dir); return { schema: 'aibo.private-state/v1', digest }; }
      const used = fs.readdirSync(dir).reduce((sum, name) => {
        const stat = fs.lstatSync(path.join(dir, name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw recoveryError('recovery_state_corrupt');
        return sum + stat.size;
      }, 0);
      if (used + bytes.length > this.maxBytes) throw recoveryError('recovery_state_write_failed');
      temporary = path.join(dir, '.' + randomUUID() + '.tmp');
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // link is create-if-absent; it never replaces an existing revision.
      try { fs.linkSync(temporary, target); } catch (error) { if (error.code !== 'EEXIST') throw error; this.readObject(dir, digest); }
      fs.unlinkSync(temporary); temporary = undefined;
      this.syncDirectory(dir);
      return { schema: 'aibo.private-state/v1', digest };
    } catch (error) {
      if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
      throw recoveryError(error.kind === 'recovery_state_corrupt' ? error.kind : 'recovery_state_write_failed');
    }
  }
}

export function boundedRecovery(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > RECOVERY_ENTRY_BYTES) throw recoveryError('recovery_state_write_failed');
  return value;
}
