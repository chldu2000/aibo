import path from 'node:path';
import {existsSync} from 'node:fs';
export function codexLauncher() {
  if (process.platform === 'win32') {
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
      if (!directory) continue;
      const npmShim = path.join(directory, 'codex.cmd');
      if (existsSync(npmShim)) {
        const script = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
        if (existsSync(script)) return { command: process.execPath, prefix: [script], shell: false };
        return { command: 'codex', prefix: [], shell: true };
      }
      const executable = path.join(directory, 'codex.exe');
      if (existsSync(executable)) return { command: executable, prefix: [], shell: false };
    }
  }
  return { command: 'codex', prefix: [], shell: process.platform === 'win32' };
}
