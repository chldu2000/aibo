import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionChangeFile, sessionChangeRowId } from '../src/lib/app/session-change-file.ts';

const file = {path:'src/lib/文件.ts',previousPath:null,kind:'modified',staged:false,unstaged:true,untracked:false,conflicted:false,unstagedStats:{additions:48,deletions:112}};
test('working, staged and mixed changes preserve diff source and complete line counts', () => {
  const working = sessionChangeFile(file);
  assert.equal(working.name, '文件.ts'); assert.equal(working.directory, 'src/lib/');
  assert.equal(working.marker, 'M'); assert.equal(working.defaultStaged, false);
  assert.deepEqual(working.stats,{additions:48,deletions:112});
  const staged = sessionChangeFile({...file,staged:true,unstaged:false,stagedStats:{additions:6,deletions:2}});
  assert.equal(staged.defaultStaged,true); assert.equal(staged.hasWorking,false);
  assert.deepEqual(staged.stats,{additions:6,deletions:2});
  const mixed = sessionChangeFile({...file,staged:true,stagedStats:{additions:6,deletions:2}});
  assert.equal(mixed.defaultStaged,false); assert.equal(mixed.stateLabel,'部分暂存');
  assert.deepEqual(mixed.stats,{additions:54,deletions:114}); assert.match(mixed.statsTitle,/非净差异/);
});
test('unknown, binary, conflicted or partially missing counts are omitted instead of shown as zero', () => {
  for (const patch of [{unstagedStats:null},{unstagedStats:undefined},{staged:true},{conflicted:true},{unstagedStats:{additions:NaN,deletions:0}},{unstagedStats:{additions:0,deletions:-1}}]) {
    assert.equal(sessionChangeFile({...file,...patch}).stats,null);
  }
  assert.deepEqual(sessionChangeFile({...file,unstagedStats:{additions:0,deletions:0}}).stats,{additions:0,deletions:0});
});
test('file kinds, renames and untracked files remain identifiable', () => {
  for (const [kind,marker] of [['added','A'],['deleted','D'],['renamed','R']]) assert.equal(sessionChangeFile({...file,kind}).marker,marker);
  assert.equal(sessionChangeFile({...file,untracked:true}).marker,'A');
  assert.equal(sessionChangeFile({...file,conflicted:true}).marker,'U');
  const renamed=sessionChangeFile({...file,kind:'renamed',previousPath:'old/原文件.ts'});
  assert.equal(renamed.name,'原文件.ts → 文件.ts'); assert.equal(renamed.directory,'old/ → src/lib/');
  assert.equal(renamed.fullPath,'old/原文件.ts → src/lib/文件.ts');
});
test('row identities distinguish repositories, delimiters and arbitrary filenames', () => {
  const pairs=[['one','same.txt'],['two','same.txt'],['a-b','c'],['a','b-c'],['a','b c'],['a','b%20c']];
  assert.equal(new Set(pairs.map(pair=>sessionChangeRowId(...pair))).size,pairs.length);
});
