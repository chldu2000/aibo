import { createInterface } from 'node:readline';
import { createCapabilityRuntime } from './runtime.mjs';
/** stdout is reserved for protocol frames; plugin diagnostics belong on stderr. */
export function serveCapability(options) {
  const runtime = createCapabilityRuntime({...options,send:message=>process.stdout.write(JSON.stringify(message)+'\n')});
  const lines = createInterface({input:process.stdin});
  lines.on('line', line => {
    try { void runtime.receive(JSON.parse(line)).catch(error=>{runtime.close(String(error));lines.close();process.exitCode=1;}); }
    catch(error) {runtime.close(String(error));lines.close();process.exitCode=1;}
  });
  lines.on('close',()=>runtime.close());
  return {close(){runtime.close();lines.close();}};
}
