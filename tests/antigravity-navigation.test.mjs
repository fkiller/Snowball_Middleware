import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePython,nativePythonEnvironment} from '../scripts/native-python.mjs';

test('actual DB-shaped Antigravity observations preserve desktop membership, native order and complete turns',()=>{
  const result=spawnSync(nativePython(),[fileURLToPath(new URL('./test_antigravity_navigation.py',import.meta.url))],{encoding:'utf8',windowsHide:true,env:nativePythonEnvironment()});
  assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+String(result.error||''));
});
