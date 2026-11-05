// Trusted local observer helper. SQLite's online backup includes committed WAL
// data; never copy only the main file or mark a live native database immutable.
import fs from 'node:fs';
import path from 'node:path';
import * as sqlite from 'node:sqlite';

const [source, destination] = process.argv.slice(2);
let native, snapshot;
try {
  if (process.argv.length !== 4 || !path.isAbsolute(source ?? '') || !path.isAbsolute(destination ?? '') ||
      typeof sqlite.backup !== 'function' || !fs.statSync(source).isFile()) throw Error();
  const directory = fs.lstatSync(path.dirname(destination));
  if (!directory.isDirectory() || directory.isSymbolicLink() || (process.platform !== 'win32' && (directory.mode & 0o077))) throw Error();
  process.umask(0o077);
  fs.closeSync(fs.openSync(destination, 'wx', 0o600));
  native = new sqlite.DatabaseSync(source, { readOnly: true });
  await sqlite.backup(native, destination);
  native.close(); native = undefined;
  // This is our private, closed backup. Converting its journal mode lets the
  // system Python read it without requiring the original's WAL/SHM files.
  snapshot = new sqlite.DatabaseSync(destination);
  snapshot.exec('PRAGMA journal_mode=DELETE');
  snapshot.close(); snapshot = undefined;
} catch {
  process.stderr.write('Native database snapshot unavailable\n');
  process.exitCode = 1;
} finally { snapshot?.close(); native?.close(); }
