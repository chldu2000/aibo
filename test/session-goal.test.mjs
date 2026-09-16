import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';

test('goal state preserves native pause, limits, completion and usage without inferring execution', async () => {
  const server = await createServer({server:{middlewareMode:true,ws:false,watch:null},appType:'custom'});
  try {
    const {normalizeAgentGoal,goalCanResume,goalStatusLabel} = await server.ssrLoadModule('/src/lib/app/session-goal.ts');
    for (const [status,normalized,label,resumable] of [
      ['paused','paused','目标已暂停',true],['complete','completed','目标已完成',false],
      ['blocked','blocked','目标受阻',true],['usageLimited','usageLimited','额度受限',true],
      ['budgetLimited','budgetLimited','目标预算已耗尽',false],['future','unknown','目标状态未知',false],
    ]) {
      const goal = normalizeAgentGoal({goal:{objective:'Keep working',status,tokensUsed:1200,tokenBudget:4000,timeUsedSeconds:32,updatedAt:1776272400}});
      assert.equal(goal.status,normalized); assert.equal(goalStatusLabel(goal,false),label); assert.equal(goalCanResume(goal),resumable);
      assert.equal(goal.tokensUsed,1200); assert.equal(goal.tokenBudget,4000); assert.equal(goal.timeUsedSeconds,32);
    }
    const active = normalizeAgentGoal({goal:{objective:'Keep working',status:'active'}});
    assert.equal(goalStatusLabel(active,false),'目标待继续');
    assert.equal(goalStatusLabel(active,true),'目标进行中');
    assert.equal(normalizeAgentGoal({goal:null}),null);
    assert.equal(normalizeAgentGoal({objective:'   '}),null);
  } finally {await server.close();}
});
