#!/usr/bin/env node
import {readFile, lstat, mkdir, writeFile, rename, rm, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parsePresentationManifest, verifyPresentationPackage} from './manifest.js';

/** Build from already bundled resources; never execute package source. */
export async function buildPresentation(configPath, outputPath) {
  const source = path.resolve(configPath), output = path.resolve(outputPath);
  const config = JSON.parse(await readFile(source, 'utf8'));
  const resources = config.resources ?? [];
  // Validate paths and all manifest fields before accessing resource paths.
  parsePresentationManifest(JSON.stringify({...config, resources:resources.map(resource=>({...resource,bytes:0,sha256:'0'.repeat(64)}))}));
  const contents = new Map();
  let total = 0;
  for (const resource of resources) {
    let current = path.dirname(source);
    for (const segment of resource.path.split('/')) {
      current = path.join(current,segment);
      if ((await lstat(current)).isSymbolicLink()) throw Error('presentation_resource_symlink');
    }
    const stat = await lstat(current);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error('invalid_presentation_resource_file');
    total += stat.size;
    if (total > 32 * 1024 * 1024) throw Error('presentation_package_too_large');
    contents.set(resource.path,await readFile(current));
  }
  const manifest = {...config,resources:resources.map(resource=>{
    const bytes = contents.get(resource.path);
    return {...resource,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  })};
  const serialized = JSON.stringify(manifest,null,2)+'\n';
  await verifyPresentationPackage(serialized,async name=>contents.get(name));
  // An existing release is never overwritten; use a fresh versioned output directory.
  await mkdir(path.dirname(output),{recursive:true});
  try { await lstat(output); throw Error('presentation_output_exists'); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const staging = await mkdtemp(path.join(path.dirname(output),'.presentation-build-'));
  try {
    for (const [name,bytes] of contents) {
      const target = path.join(staging,name);
      await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,bytes);
    }
    await writeFile(path.join(staging,'presentation.json'),serialized);
    await rename(staging,output);
  } finally { await rm(staging,{recursive:true,force:true}); }
  return manifest;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , config, output, ...extra] = process.argv;
  if (!config || !output || extra.length) { console.error('Usage: aibo-presentation-build <source.json> <new-output-directory>'); process.exitCode=1; }
  else try { const manifest=await buildPresentation(config,output); console.log(`${manifest.id}@${manifest.version}: ${path.resolve(output)}`); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
