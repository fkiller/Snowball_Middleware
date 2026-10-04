import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const destination = path.join(root, 'artifacts', 'desktop', `ci-${Date.now()}`);
if (fs.existsSync(destination)) throw new Error('CI package destination already exists');
const packageOutput = execFileSync(process.execPath, [fileURLToPath(new URL('./package-desktop.mjs', import.meta.url)), destination], {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 180000,
});
const line = packageOutput.trim().split(/\r?\n/).reverse().find(value => value.startsWith('{') && value.includes('"paths"'));
const result = JSON.parse(line ?? 'null');
if (!Array.isArray(result?.paths) || result.paths.length !== 1 || !path.isAbsolute(result.paths[0]) || !fs.existsSync(result.paths[0]))
  throw new Error('Packager did not return one existing artifact');
const packageDir = result.paths[0];
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `package_dir=${packageDir}\n`);
const smoke = execFileSync(process.execPath, [fileURLToPath(new URL('./verify-packaged-desktop.mjs', import.meta.url)), packageDir], {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 60000,
});
console.log(smoke.trim());
let artifactPath;
const extracted = fs.mkdtempSync(path.join(root, 'artifacts', 'package-roundtrip-'));
let roundtripDir;
if (process.platform === 'darwin') {
  const app = path.join(packageDir, 'Snowball Middleware.app');
  const archive = path.join(path.dirname(packageDir), `SnowballMiddleware-macos-${process.arch}.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], { cwd: root, stdio: 'pipe', timeout: 120000 });
  if (!fs.statSync(archive).isFile()) throw new Error('macOS app archive missing');
  execFileSync('ditto', ['-x', '-k', archive, extracted], { cwd: root, stdio: 'pipe', timeout: 120000 });
  roundtripDir = extracted;
  artifactPath = archive;
} else if (process.platform === 'win32') {
  const archive = path.join(path.dirname(packageDir), `SnowballMiddleware-win32-${process.arch}.zip`);
  execFileSync('tar.exe', ['-a', '-c', '-f', archive, '-C', path.dirname(packageDir), path.basename(packageDir)], { cwd: root, windowsHide: true, stdio: 'pipe', timeout: 120000 });
  execFileSync('tar.exe', ['-x', '-f', archive, '-C', extracted], { cwd: root, windowsHide: true, stdio: 'pipe', timeout: 120000 });
  roundtripDir = path.join(extracted, path.basename(packageDir));
  artifactPath = archive;
} else throw new Error('Native desktop archive verification requires Windows or macOS');
const roundtrip = execFileSync(process.execPath, [fileURLToPath(new URL('./verify-packaged-desktop.mjs', import.meta.url)), roundtripDir], {
  cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 60000,
});
console.log(roundtrip.trim());
if (!fs.statSync(artifactPath).isFile()) throw new Error('Verified desktop archive missing');
const digest = createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
fs.writeFileSync(artifactPath+'.sha256', `${digest}  ${path.basename(artifactPath)}\n`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `### ${process.platform} ${process.arch}\n\nNative package and extracted ZIP smoke checks passed.\n\nArchive: \`${path.basename(artifactPath)}\`\n\nSHA-256: \`${digest}\`\n`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `artifact_path=${artifactPath}\n`);
