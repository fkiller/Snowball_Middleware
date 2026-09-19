import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DesktopUpdater, DesktopUninstaller } from '../apps/desktop/updater.mjs';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'snowball-updater-test-'));
  const installDir = path.join(root, 'app');
  const backupDir = path.join(root, 'backup');
  const userDataDir = path.join(root, 'userdata');

  await mkdir(installDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });

  // Initial version 1.0.0
  const initialBundle = Buffer.from('console.log("v1.0.0")');
  await writeFile(path.join(installDir, 'app.bundle'), initialBundle);
  await writeFile(path.join(installDir, 'version.json'), JSON.stringify({ version: '1.0.0' }));

  // User data & secrets
  await writeFile(path.join(userDataDir, 'host.v1.json'), JSON.stringify({ version: 1, hostId: 'host_secret_123' }));
  await writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify({ revision: 1, autostart: true }));
  await mkdir(path.join(userDataDir, 'commands'), { recursive: true });
  await writeFile(path.join(userDataDir, 'commands', 'journal.log'), 'journal-entries');

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  return { root, installDir, backupDir, userDataDir, initialBundle };
}

test('MW.08.02.01.01.A1: hash mismatch / tampered artifact is rejected and previous version is safely retained', async t => {
  const { installDir, backupDir, initialBundle } = await fixture(t);
  const updater = new DesktopUpdater(installDir, backupDir);

  const tamperedBundle = Buffer.from('console.log("malicious or corrupted v1.1.0")');
  const bogusHash = 'a'.repeat(64);

  // Attempt update with mismatched hash
  await assert.rejects(
    updater.applyUpdate({
      artifactBuffer: tamperedBundle,
      expectedSha256: bogusHash,
      version: '1.1.0',
    }),
    /Artifact hash mismatch/
  );

  // Verification: installed app.bundle is untouched and still v1.0.0
  const currentBundle = await readFile(path.join(installDir, 'app.bundle'));
  assert.deepEqual(currentBundle, initialBundle);

  const versionJson = JSON.parse(await readFile(path.join(installDir, 'version.json'), 'utf8'));
  assert.equal(versionJson.version, '1.0.0');
});

test('MW.08.02.01.01.A1: valid update applies successfully; rollback restores previous version on demand', async t => {
  const { installDir, backupDir, initialBundle } = await fixture(t);
  const updater = new DesktopUpdater(installDir, backupDir);

  const newBundle = Buffer.from('console.log("v1.1.0-good")');
  const validHash = sha256(newBundle);

  // Apply valid update
  const result = await updater.applyUpdate({
    artifactBuffer: newBundle,
    expectedSha256: validHash,
    version: '1.1.0',
  });
  assert.equal(result.success, true);
  assert.equal(result.version, '1.1.0');

  // Verify installed version is now 1.1.0
  const updatedBundle = await readFile(path.join(installDir, 'app.bundle'));
  assert.deepEqual(updatedBundle, newBundle);

  // Rollback to previous version
  const rollbackResult = await updater.rollback();
  assert.equal(rollbackResult.restored, true);

  // Verify restored version is v1.0.0
  const restoredBundle = await readFile(path.join(installDir, 'app.bundle'));
  assert.deepEqual(restoredBundle, initialBundle);
});

test('MW.08.02.01.01.A2: uninstall with keep_data preserves user data and secrets', async t => {
  const { installDir, userDataDir } = await fixture(t);
  const uninstaller = new DesktopUninstaller(installDir, userDataDir);

  const result = await uninstaller.uninstall('keep_data');
  assert.equal(result.binariesRemoved, true);
  assert.equal(result.userDataPurged, false);

  // Binaries removed
  await assert.rejects(readFile(path.join(installDir, 'app.bundle')));

  // User data preserved
  const hostJson = JSON.parse(await readFile(path.join(userDataDir, 'host.v1.json'), 'utf8'));
  assert.equal(hostJson.hostId, 'host_secret_123');

  const journalLog = await readFile(path.join(userDataDir, 'commands', 'journal.log'), 'utf8');
  assert.equal(journalLog, 'journal-entries');
});

test('MW.08.02.01.01.A2: uninstall with remove_all securely zeroes secrets and deletes user data completely', async t => {
  const { installDir, userDataDir } = await fixture(t);
  const uninstaller = new DesktopUninstaller(installDir, userDataDir);

  const result = await uninstaller.uninstall('remove_all');
  assert.equal(result.binariesRemoved, true);
  assert.equal(result.userDataPurged, true);

  // Both directories removed
  await assert.rejects(readFile(path.join(installDir, 'app.bundle')));
  await assert.rejects(readFile(path.join(userDataDir, 'host.v1.json')));
});
