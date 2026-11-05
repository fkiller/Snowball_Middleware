import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as sqlite from 'node:sqlite';
import { createHash } from 'node:crypto';
import { nativePython, nativePythonEnvironment } from '../scripts/native-python.mjs';

const { DatabaseSync } = sqlite;
const snapshotOptions = { skip: typeof sqlite.backup !== 'function' ? 'Online SQLite backup requires Node 22.16+' : false };

test('native snapshot includes committed WAL rows without changing the source and refuses overwrite', snapshotOptions, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-native-snapshot-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'native.db'), target = path.join(directory, 'copy.db');
  const writer = new DatabaseSync(source);
  t.after(() => writer.close());
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE observed(value TEXT); INSERT INTO observed VALUES (\'from WAL\');');
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const main = digest(source), wal = digest(source + '-wal');
  const run = () => spawnSync(process.execPath, ['scripts/snapshot-native-db.mjs', source, target], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  const copy = new DatabaseSync(target, { readOnly: true });
  assert.equal(copy.prepare('SELECT value FROM observed').get().value, 'from WAL'); copy.close();
  assert.equal(digest(source), main); assert.equal(digest(source + '-wal'), wal);
  assert.notEqual(run().status, 0);
});

test('Python read-only fallback uses a private consistent snapshot and removes it on close', snapshotOptions, () => {
  const python = nativePython();
  const code = `import os,sqlite3,tempfile,sys\nfrom pathlib import Path\nfrom unittest.mock import patch\nsys.path.insert(0,'scripts')\nfrom native_database import open_native_database\nwith tempfile.TemporaryDirectory() as tmp:\n p=Path(tmp)/'source.db'\n w=sqlite3.connect(p);w.execute('pragma journal_mode=wal');w.execute('create table data(value)');w.execute('insert into data values(7)');w.commit()\n original=sqlite3.connect\n def connect(file,*a,**kw):\n  if str(file).startswith(p.as_uri()):raise sqlite3.OperationalError('unable to open database file')\n  return original(file,*a,**kw)\n with patch('sqlite3.connect',side_effect=connect):c=open_native_database(p)\n assert c.execute('select value from data').fetchone()[0]==7\n snapshot=c.snapshot_directory.name\n assert os.stat(snapshot).st_mode & 0o077 == 0\n try:c.execute('insert into data values(8)');raise AssertionError('must be read only')\n except sqlite3.OperationalError:pass\n c.close();assert not Path(snapshot).exists();w.close()\n`;
  const result = spawnSync(python, ['-c', code], { encoding: 'utf8', env: nativePythonEnvironment() });
  assert.equal(result.status, 0, result.stderr);
});
