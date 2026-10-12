import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Unix bootstrap parses on Bash 3+, prints help and rejects incomplete/unknown options before installing', {skip:process.platform==='win32'}, () => {
  const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
  const run = args => spawnSync('bash', args, {encoding:'utf8', timeout:10000});
  assert.equal(run(['-n', installer]).status, 0);
  const help = run([installer, '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root PATH/);
  for (const args of [['--root'], ['--python'], ['--bad-option'], ['--root', '--update']]) {
    const result = run([installer, ...args]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing value|Unknown option/);
  }
});
