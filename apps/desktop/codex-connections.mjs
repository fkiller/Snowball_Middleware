import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { ensurePrivateStateDirectory } from '../supervisor/private-state.mjs';

const maxBytes = 16 * 1024;
const filename = 'codex.v1.json';

/** The native picker supplies these paths. A browser never supplies a launch path. */
export async function inspectCodexSelection(selection) {
  const names = ['executable', 'codexHome', 'workingDirectory'];
  if (!names.every(name => typeof selection?.[name] === 'string' && path.isAbsolute(selection[name]) && selection[name].length <= 4096)) throw new Error('Absolute Codex paths required');
  const [executable, codexHome, workingDirectory] = names.map(name => fs.realpathSync(selection[name]));
  const info = fs.statSync(executable);
  if (!info.isFile() || info.size > 512 * 1024 * 1024 || !fs.statSync(codexHome).isDirectory() || !fs.statSync(workingDirectory).isDirectory() || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error('Unsupported Codex selection');
  const version = await new Promise((resolve, reject) => execFile(executable, ['--version'], { timeout: 5000, maxBuffer: 16 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout) => error ? reject(new Error('Codex version probe failed')) : resolve(stdout.trim())));
  if (version !== 'codex-cli 0.153.4') throw new Error('This Codex version is not yet supported');
  const hash = createHash('sha256');
  const stream = fs.createReadStream(executable);
  const timer = setTimeout(() => stream.destroy(new Error('Codex hash timeout')), 5000);
  try { for await (const chunk of stream) hash.update(chunk); }
  finally { clearTimeout(timer); stream.destroy(); }
  if (fs.realpathSync(executable) !== executable) throw new Error('Codex executable changed during review');
  return { executable, sha256: hash.digest('hex'), version: '0.153.4', codexHome, workingDirectory };
}

function location(dataDir) {
  return path.join(ensurePrivateStateDirectory(path.join(dataDir, 'connections'), [filename]), filename);
}

function validateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes ||
    (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw new Error('Private connection state requires review');
}

export function loadCodexConnections(dataDir) {
  const file = location(dataDir);
  try { validateFile(file); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, connections: [] }; throw error; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data?.version !== 1 || !Array.isArray(data.connections) || data.connections.length > 8) throw new Error('Invalid saved Codex connections');
  const ids = new Set();
  for (const item of data.connections) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(item?.instanceId) || ids.has(item.instanceId) ||
      typeof item.launch?.executable !== 'string' || typeof item.launch?.sha256 !== 'string' ||
      item.launch?.version !== '0.153.4' || typeof item.launch?.codexHome !== 'string' ||
      typeof item.launch?.workingDirectory !== 'string') throw new Error('Invalid saved Codex connection');
    ids.add(item.instanceId);
  }
  return data;
}

function writeCodexConnections(dataDir, next) {
  const file = location(dataDir), temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  const bytes = Buffer.from(JSON.stringify(next) + '\n');
  if (bytes.length > maxBytes) throw new Error('Codex connection state too large');
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
    if (process.platform !== 'win32') { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
    return next;
  } catch (error) { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch {} throw error; }
}

export function appendCodexConnection(dataDir, current, launch, instanceId = 'local-' + randomBytes(6).toString('hex')) {
  if (current.connections.length >= 8) throw new Error('Codex connection limit reached');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(instanceId) || current.connections.some(item => item.instanceId === instanceId)) throw new Error('Codex instance already exists');
  const next = structuredClone(current);
  next.connections.push({ instanceId, launch });
  writeCodexConnections(dataDir,next);
  return { config: next, instanceId };
}

export function removeCodexConnection(dataDir, instanceId) {
  const current=loadCodexConnections(dataDir);
  if (!current.connections.some(item=>item.instanceId===instanceId)) throw new Error('connection_missing');
  return writeCodexConnections(dataDir,{version:1,connections:current.connections.filter(item=>item.instanceId!==instanceId)});
}

/** Explicit native-confirmed repair of only the saved connection references. */
export function resetCodexConnections(dataDir) {
  return writeCodexConnections(dataDir,{version:1,connections:[]});
}
