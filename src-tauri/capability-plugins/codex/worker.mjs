import {readFileSync} from 'node:fs';
import {serveCapabilities} from './stdio.mjs';
import {sessionProvider} from './session-provider.mjs';
import * as engine from './engine.mjs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url),'utf8'));
const contribution=manifest.contributions[0];
const provider=sessionProvider({engine,pluginId:manifest.pluginId,actions:{"dev.aibo.codex.queue.manage":"ext.dev.aibo.codex.queue","dev.aibo.codex.session.snapshot":"ext.dev.aibo.codex.snapshot","dev.aibo.codex.session.fork":"ext.dev.aibo.codex.fork","dev.aibo.codex.goal.manage": "ext.dev.aibo.codex.goal", "dev.aibo.codex.model.select": "ext.dev.aibo.codex.model", "dev.aibo.codex.model.reasoning": "ext.dev.aibo.codex.reasoning", "dev.aibo.codex.model.service-tier": "ext.dev.aibo.codex.service-tier", "dev.aibo.codex.skill.list": "ext.dev.aibo.codex.skills", "dev.aibo.codex.approval.respond": "ext.dev.aibo.codex.approval", "dev.aibo.codex.user-input.respond": "ext.dev.aibo.codex.user-input"}});
serveCapabilities([{protocol:'2.1',pluginId:manifest.pluginId,pluginVersion:manifest.version,contributionId:contribution.id,
  operations:contribution.operations.map(op=>({capability:op.capability.id,version:op.capability.version,operationId:op.id})),
  invoke:provider.invoke,control:provider.control,
},{protocol:'2.1',pluginId:manifest.pluginId,pluginVersion:manifest.version,contributionId:manifest.contributions[1].id,
  operations:manifest.contributions[1].operations.map(op=>({capability:op.capability.id,version:op.capability.version,operationId:op.id})),
  invoke:engine.listThreads,
}]);
process.stdin.on('end',()=>void provider.close());
