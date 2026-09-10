import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('Pi plugin and legacy SDK adapter pass the same offline parity scenario', { concurrency: false }, async () => {
  const result = await execFileAsync('node', ['probes/pi-plugin-diff.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, AIBO_PROBE_OUTPUT: process.env.AIBO_PROBE_OUTPUT },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr);
});
