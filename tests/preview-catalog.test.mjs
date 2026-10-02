import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseAntigravityCatalog, parseOpenCodeCatalog } from '../scripts/harness-catalog-scanner.mjs';
import { ContextManager } from '../scripts/context-manager.mjs';
import { dispatchHarnessTurn } from '../scripts/harness-dispatch.mjs';

test('Preview catalog never invents model-specific efforts when metadata is absent', () => {
  const ag=parseAntigravityCatalog('actual-high\tActual (High)\nother\tOther\n');
  assert.deepEqual(ag.map(m=>m.efforts),[['high'],[]]);
  assert.deepEqual(parseAntigravityCatalog(''),[]);
  const cache={provider:{models:{model:{reasoning:true},fixed:{reasoning:true,variants:{native:{}}},basic:{reasoning:false}}}};
  assert.deepEqual(parseOpenCodeCatalog('provider/model\nprovider/fixed\nprovider/basic\n',cache).map(m=>m.efforts),[[],['native'],[]]);
  assert.deepEqual(parseOpenCodeCatalog('',cache),[]);
});

test('No discovered sessions/projects means an empty catalog', () => {
  const c=new ContextManager();
  assert.deepEqual(c.getProjectsForCurrentScope(),[]);
  assert.deepEqual(c.getSessionsForCurrentScope(),[]);
  assert.equal(c.getCurrentProject().id,'none');
  assert.equal(c.getCurrentSession().id,'none');
});

test('Cancelled dispatch cannot start a native process', async () => {
  const controller=new AbortController(); controller.abort();
  await assert.rejects(dispatchHarnessTurn({harnessId:'snowball.codex',signal:controller.signal}), error=>error.name==='AbortError');
});

test('Preview files require a selected project and cannot read its parent', async () => {
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'snowball-workspace-'));
  try {
    const root=path.join(scratch,'project'); await fs.mkdir(root);
    await fs.writeFile(path.join(root,'inside.txt'),'selected project');
    await fs.writeFile(path.join(scratch,'outside.txt'),'outside project');
    const c=new ContextManager();
    await c.readWorkspaceFiles(root);
    assert.deepEqual(c.workspaceFiles,[]);
    c.projectsByScope[c.getScopeKey()]=[{id:'fixture',name:'Fixture',path:root}];
    await c.readWorkspaceFiles();
    await c.openFileContent(0,'../outside.txt');
    assert.equal(c.isWorkspaceViewerActive,false);
    await c.openFileContent(0,'inside.txt');
    assert.equal(c.isWorkspaceViewerActive,true);
    assert.deepEqual(c.workspaceFileContentLines,['selected project']);
  } finally { await fs.rm(scratch,{recursive:true,force:true}); }
});
