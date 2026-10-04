import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseManifest} from '../packages/plugin-sdk/dist/index.js';
import {codexManifest,harnessPresentation as codex} from '../packages/harness-codex/dist/index.js';
import {antigravityManifest,harnessPresentation as agy} from '../packages/harness-antigravity/dist/index.js';
import {opencodeManifest,harnessPresentation as ocode} from '../packages/harness-opencode/dist/index.js';
import {LocalApi} from '../packages/api/dist/index.js';
import {CommandJournal} from '../packages/core/dist/index.js';
test('each harness defines its distinct bounded glyph in its actual manifest',async()=>{
  const manifests=await Promise.all([codexManifest(),antigravityManifest(),opencodeManifest()]);
  assert.equal(new Set(manifests.map(m=>JSON.stringify(m.presentation.icon.rows))).size,3);
  for(const m of manifests){assert.equal(m.presentation.icon.rows.length,16);assert.ok(Object.isFrozen(m.presentation.icon.rows));}
  for(const invalid of [{size:16,rows:Array(16).fill(-1)},{size:32,rows:Array(16).fill(0)},{size:16,rows:[1]}])assert.throws(()=>parseManifest({...manifests[0],presentation:{name:'Test',icon:invalid}}),/presentation/);
});
test('the real API carries plugin presentation without granting a controller or native command',async()=>{
  const presentations={'snowball.codex':codex,'snowball.antigravity':agy,'snowball.opencode':ocode};
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'snowball-harness-presentation-'));
  const journal=new CommandJournal({hostId:'host_'+'a'.repeat(32),directory}),api=new LocalApi({journal,noAuth:true,port:0,harnessPresentations:presentations});await api.start();
  try{const response=await fetch(api.origin+'/v1/snapshot',{headers:{Origin:api.origin}});const snapshot=await response.json();assert.deepEqual(snapshot.harnessPresentations,presentations);assert.equal(journal.listCommands().length,0);}
  finally{await api.close();journal.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(directory,{recursive:true,force:true});}
});
