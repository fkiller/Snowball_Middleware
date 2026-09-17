// Explicit, reproducible export of the prototype; never moves/deletes source files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed in export: ${entry.name}`);
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const files = [
  ...walk(path.join(root, 'host/src')).filter(file => /\.(ts|py)$/.test(file)),
  ...walk(path.join(root, 'host/tests')).filter(file => file.endsWith('.mjs')),
  ...['package.json', 'package-lock.json', 'tsconfig.json'].map(file => path.join(root, 'host', file)),
];
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/));
const inventory = {
  version: 1, sourceRoot: root, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  generatedAt: new Date().toISOString(),
  license: 'No root LICENSE/COPYING/NOTICE found. Internal development export only; public redistribution requires license/provenance review. Generated provider types retain their original headers.',
  exclusions: ['host/node_modules', 'host/dist', 'host/.state', 'host/.venv*', 'host/probes', 'host/poc', 'recordings and temporary WAV fixtures', 'hardware firmware/toolchain/binaries', 'environment files and credentials'],
  tests: { portable: 'All host/tests except integration.test.mjs and whisper-worker.test.mjs (44 tests at baseline). Local mock HTTP/mesh sockets are used.', optionalSpeech: 'integration.test.mjs and whisper-worker.test.mjs require Python + faster-whisper + cached model, optionally an external prerecorded WAV. Not redistributed.', live: 'No live provider command/hardware test included in default suite.' },
  files: files.map(file => {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    return { source: relative, target: relative.replace(/^host\//, 'reference/legacy-host/'), sha256: sha(file), bytes: fs.statSync(file).size, tracked: tracked.has(relative), role: relative.includes('/generated/') ? 'generated-provider-schema' : relative.includes('/tests/') ? 'regression-test' : relative.endsWith('.py') ? 'optional-speech-worker' : 'prototype-source-or-build-config' };
  }).sort((a, b) => a.source.localeCompare(b.source)),
};
const evidence = path.join(root, 'docs/middleware/evidence/MW.01.01.01.01');
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(evidence, 'source-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
const targetArg = process.argv.indexOf('--target');
if (targetArg >= 0) {
  if (!process.argv[targetArg + 1]) throw new Error('--target needs an absolute path');
  const target = path.resolve(process.argv[targetArg + 1]);
  if (fs.existsSync(target)) throw new Error(`Refusing to overwrite existing destination: ${target}`);
  if (target.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Destination must be a separate repository outside source');
  fs.mkdirSync(target);
  for (const entry of inventory.files) {
    const destination = path.join(target, entry.target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, entry.source), destination);
    if (sha(destination) !== entry.sha256) throw new Error(`Copy mismatch: ${entry.source}`);
  }
  fs.cpSync(path.join(root, 'docs/middleware'), path.join(target, 'docs/middleware'), { recursive: true });
  for (const name of fs.readdirSync(path.join(root, 'docs')).filter(name => name.endsWith('.md'))) {
    fs.copyFileSync(path.join(root, 'docs', name), path.join(target, 'docs', name));
  }
  for (const name of ['AGENTS.md', 'HANDOFF.md']) fs.copyFileSync(path.join(root, name), path.join(target, name));
  console.log(`Exported ${inventory.files.length} hash-verified files to ${target}`);
}
for (const entry of inventory.files) if (sha(path.join(root, entry.source)) !== entry.sha256) throw new Error(`Source changed during export: ${entry.source}`);
console.log(`Inventory: ${inventory.files.length} files; source bytes preserved; no runtime/secret/model directories exported.`);
