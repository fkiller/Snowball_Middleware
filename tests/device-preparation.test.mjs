import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/prepare-installed-m5stack.mjs',import.meta.url));
const run=args=>spawnSync(process.execPath,[script,...args],{windowsHide:true,encoding:'utf8',env:{...process.env,AGY_CLI_DISABLE_AUTO_UPDATE:'true'}});
test('installed device preparation exposes verification without installing dependencies or touching a device',()=>{
  const result=run(['--help']);assert.equal(result.status,0);
  assert.match(result.stdout,/Default: verify existing firmware without flashing/);
});
test('USB preparation requires an existing install and rejects invalid ports before reading configuration or opening USB',()=>{
  const absent=run(['--flash']);assert.notEqual(absent.status,0);assert.match(absent.stderr,/Supply --config/);
  const invalid=run(['--config','missing-suite.json','--serial','COM7;echo injected']);
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Invalid USB port/);assert.doesNotMatch(invalid.stderr,/ENOENT/);
});
