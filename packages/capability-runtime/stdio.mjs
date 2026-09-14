import { createInterface } from 'node:readline';
import { createCapabilityRuntime } from './runtime.mjs';
/** stdout is reserved for protocol frames; plugin diagnostics belong on stderr. */
function serve(select) {
  let runtime;
  const send = message=>process.stdout.write(JSON.stringify(message)+'\n');
  const lines = createInterface({input:process.stdin});
  const fail = error=>{runtime?.close(String(error));lines.close();process.exitCode=1;};
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (!runtime) {
        const options = select(message);
        if (!options) throw Error('Unknown capability contribution initialization');
        runtime = createCapabilityRuntime({...options,send});
      }
      void runtime.receive(message).catch(fail);
    } catch(error) {fail(error);}
  });
  lines.on('close',()=>runtime?.close());
  return {close(){runtime?.close();lines.close();}};
}
export function serveCapability(options) { return serve(()=>options); }
/** One process binds exactly one declared contribution for its entire generation. */
export function serveCapabilities(contributions) {
  const ids = new Set(contributions.map(options=>options.contributionId));
  if (!contributions.length || ids.size!==contributions.length) throw Error('Duplicate or empty contribution configuration');
  return serve(message=>message?.method==='capability.initialize'
    ? contributions.find(options=>options.contributionId===message.params?.contributionId)
    : undefined);
}
