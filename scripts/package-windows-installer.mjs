import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows x64 installer on Windows x64');
const root = fileURLToPath(new URL('..', import.meta.url));
const packageDir = process.argv[2];
if (!packageDir || !path.isAbsolute(packageDir)) throw new Error('Absolute packaged desktop directory required');
const absolutePackage = fs.realpathSync(packageDir);
const relative = path.relative(path.join(root, 'artifacts', 'desktop'), absolutePackage);
if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Package must be inside the reviewed desktop artifacts');
const appDir = path.join(absolutePackage, 'resources', 'app');
const inventory = JSON.parse(fs.readFileSync(path.join(appDir, 'BUILD-INVENTORY.json'), 'utf8'));
if (inventory.platform !== 'win32' || inventory.arch !== 'x64' || !Array.isArray(inventory.files) || inventory.files.length < 1) throw new Error('Invalid package inventory');
for (const item of inventory.files) {
  if (typeof item.path !== 'string' || !/^[A-Za-z0-9_@./-]+$/.test(item.path) || item.path.includes('..') || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Invalid inventory entry');
  const digest = createHash('sha256').update(fs.readFileSync(path.join(appDir, item.path))).digest('hex');
  if (digest !== item.sha256) throw new Error('Package changed after review');
}
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid installer version');
const compiler = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe');
if (!fs.existsSync(compiler)) throw new Error('Inno Setup 6 ISCC.exe is required');
const outputDir = path.join(root, 'artifacts', 'installers', String(Date.now()));
fs.mkdirSync(outputDir, { recursive: true });
const args = ['/Q', '/DSourceDir=' + absolutePackage, '/DOutputDir=' + outputDir, '/DAppVersion=' + version,
  path.join(root, 'scripts', 'windows-installer.iss')];
await new Promise((resolve, reject) => {
  const child = spawn(compiler, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk; if (output.length > 65536) child.kill(); });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error('Installer compiler failed: ' + output.slice(-1500))));
});
const setup = path.join(outputDir, `SnowballMiddlewareSetup-${version}-win-x64.exe`);
if (!fs.statSync(setup).isFile()) throw new Error('Installer output missing');
const sha256 = createHash('sha256').update(fs.readFileSync(setup)).digest('hex');
console.log(JSON.stringify({ setup, sha256, signed: false, sourcePackage: absolutePackage, inventoryFiles: inventory.files.length }));
