import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const targets = [
  { repoName: 'Snowball_Harness_Codex' },
  { repoName: 'Snowball_Harness_OpenCode' },
  { repoName: 'Snowball_Harness_Antigravity' }
];

const exportDir = 'e:/developments/projects/Snowball_Middleware/.export_test';
const stagingDir = path.join(os.tmpdir(), 'snowball-harness-sync-' + Date.now());
fs.mkdirSync(stagingDir, { recursive: true });

console.log('Staging in:', stagingDir);

for (const { repoName } of targets) {
  console.log(`\n=================== Syncing ${repoName} ===================`);
  const repoPath = path.join(stagingDir, repoName);
  const sourcePath = path.join(exportDir, repoName);

  // 1. Clone
  console.log(`Cloning https://github.com/fkiller/${repoName}.git...`);
  execFileSync('git', ['clone', `https://github.com/fkiller/${repoName}.git`, repoPath], {
    stdio: 'inherit',
    windowsHide: true
  });

  // 2. Checkout main
  execFileSync('git', ['checkout', '-B', 'main'], { cwd: repoPath, stdio: 'inherit', windowsHide: true });

  // 3. Copy files from sourcePath to repoPath (skip .git)
  const items = fs.readdirSync(sourcePath);
  for (const item of items) {
    if (item === '.git') continue;
    const src = path.join(sourcePath, item);
    const dst = path.join(repoPath, item);
    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true, force: true });
    }
    fs.cpSync(src, dst, { recursive: true });
  }

  // 4. Git status & commit
  execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'inherit', windowsHide: true });
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repoPath, encoding: 'utf8', windowsHide: true });
  if (status.trim()) {
    console.log('Committing changes...');
    execFileSync(
      'git',
      [
        'commit',
        '-m',
        'feat: release official standalone harness plugin under Apache-2.0\n\n- Add Apache-2.0 LICENSE\n- Add official Snowball branding assets (banner, icon)\n- Standardize repository name and public release README\n- Update SDK protocol and standalone test suites\n- Configure GitHub Actions CI workflow for Windows and macOS'
      ],
      { cwd: repoPath, stdio: 'inherit', windowsHide: true }
    );

    console.log('Pushing to origin main...');
    execFileSync('git', ['push', 'origin', 'main'], { cwd: repoPath, stdio: 'inherit', windowsHide: true });
    console.log(`Successfully pushed ${repoName} to origin/main!`);
  } else {
    console.log(`No changes to commit for ${repoName}.`);
  }
}

console.log('\nAll harness plugins successfully synchronized and pushed!');
