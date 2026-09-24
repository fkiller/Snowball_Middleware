import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const provider = pkg.name.split('/').at(-1)?.replace(/^harness-/, '');
const npm = process.env.npm_execpath;
if (!npm || !fs.existsSync(npm) || !provider) throw new Error('Run through npm in a standalone harness repository');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-plugin-pack-'));
const run = (args, cwd) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 });
try {
  const [packed] = JSON.parse(run([npm, 'pack', '--ignore-scripts', '--pack-destination', temp, '--json'], root));
  if (!packed?.bundled?.includes('@snowball/plugin-sdk') ||
      !packed.files?.some(file => file.path === 'docs/INTEGRATION.md') ||
      !packed.files?.some(file => file.path === 'dist/worker.js')) throw new Error('Release package omitted SDK, guide or worker');
  const consumer = path.join(temp, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"name":"consumer-smoke","version":"1.0.0","private":true,"type":"module"}\n');
  run([npm, 'install', path.join(temp, packed.filename), '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  run(['--input-type=module', '-e', `const m=await import(${JSON.stringify(pkg.name)}); if(typeof m[${JSON.stringify(provider + 'Manifest')}]!=='function') process.exit(1);`], consumer);
  console.log(JSON.stringify({ package: pkg.name, bundledSdk: true, freshInstall: true, independentImport: true }));
} finally {
  const resolved = path.resolve(temp), base = path.resolve(os.tmpdir());
  if (!resolved.startsWith(base + path.sep)) throw new Error('Temporary package path escaped OS temp');
  fs.rmSync(resolved, { recursive: true, force: true });
}
