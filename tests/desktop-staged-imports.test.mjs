import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyStagedImports} from '../scripts/verify-staged-imports.mjs';

test('staged relative imports reject missing files and permit real CJS resolution', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-stage-check-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'app'));
  fs.writeFileSync(path.join(root,'app','main.mjs'),"import './manager.mjs'; export {x} from './helper.js'; import('./later.mjs');\n");
  fs.writeFileSync(path.join(root,'app','cjs.cjs'),"require('./common');\n");
  for(const name of ['manager.mjs','helper.js','later.mjs','common.js'])fs.writeFileSync(path.join(root,'app',name),'');
  const files=['app/main.mjs','app/cjs.cjs'];
  assert.doesNotThrow(()=>verifyStagedImports(root,files));
  fs.rmSync(path.join(root,'app','manager.mjs'));
  assert.throws(()=>verifyStagedImports(root,files),/app\/main\.mjs: \.\/manager\.mjs/);
  fs.writeFileSync(path.join(root,'app','manager.mjs'),'');
  fs.rmSync(path.join(root,'app','common.js'));
  assert.throws(()=>verifyStagedImports(root,files),/app\/cjs\.cjs: \.\/common/);
});

test('actual reviewed desktop staging contains all static relative imports', () => {
  const script=fileURLToPath(new URL('../scripts/package-desktop.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'--verify-stage'],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr || result.stdout);
  assert.match(result.stdout,/Staged static relative imports verified/);
});
