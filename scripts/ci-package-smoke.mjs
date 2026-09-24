import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
let artifactPath = packageDir;
if (process.platform === 'darwin') {
  const app = path.join(packageDir, 'Snowball Middleware.app');
  const archive = path.join(path.dirname(packageDir), `SnowballMiddleware-macos-${process.arch}.zip`);
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], { cwd: root, stdio: 'pipe', timeout: 120000 });
  if (!fs.statSync(archive).isFile()) throw new Error('macOS app archive missing');
  const extracted = fs.mkdtempSync(path.join(root, 'artifacts', 'mac-roundtrip-'));
  execFileSync('ditto', ['-x', '-k', archive, extracted], { cwd: root, stdio: 'pipe', timeout: 120000 });
  const roundtrip = execFileSync(process.execPath, [fileURLToPath(new URL('./verify-packaged-desktop.mjs', import.meta.url)), extracted], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 60000,
  });
  console.log(roundtrip.trim());
  artifactPath = archive;
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `artifact_path=${artifactPath}\n`);
