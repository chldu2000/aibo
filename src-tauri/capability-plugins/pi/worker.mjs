import {readFileSync} from 'node:fs';
import {serveCapability} from './stdio.mjs';
import {sessionProvider} from './session-provider.mjs';
import * as engine from './engine.mjs';
const manifest=JSON.parse(readFileSync(new URL('./plugin.json',import.meta.url),'utf8'));
const contribution=manifest.contributions[0];
const provider=sessionProvider({engine,pluginId:manifest.pluginId,actions:{"dev.aibo.pi.session.timeline":"ext.dev.aibo.pi.snapshot","dev.aibo.pi.model.context-window":"ext.dev.aibo.pi.context-window","dev.aibo.pi.model.select": "ext.dev.aibo.pi.model", "dev.aibo.pi.model.reasoning": "ext.dev.aibo.pi.reasoning", "dev.aibo.pi.command.list": "ext.dev.aibo.pi.commands", "dev.aibo.pi.skill.list": "ext.dev.aibo.pi.skills", "dev.aibo.pi.queue.manage": "ext.dev.aibo.pi.queue", "dev.aibo.pi.compaction.run": "ext.dev.aibo.pi.compact", "dev.aibo.pi.session.tree": "ext.dev.aibo.pi.tree", "dev.aibo.pi.session.snapshot": "ext.dev.aibo.pi.snapshot", "dev.aibo.pi.session.reload": "ext.dev.aibo.pi.reload"}});
serveCapability({protocol:'2.1',pluginId:manifest.pluginId,pluginVersion:manifest.version,contributionId:contribution.id,
  operations:contribution.operations.map(op=>({capability:op.capability.id,version:op.capability.version,operationId:op.id})),
  invoke:provider.invoke,control:provider.control,
});
process.stdin.on('end',()=>void provider.close());
