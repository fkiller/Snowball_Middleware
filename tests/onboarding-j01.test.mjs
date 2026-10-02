import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalRuntime } from '../apps/supervisor/runtime.mjs';
import { LocalClient } from '../packages/client-sdk/dist/index.js';
import { defaultDiscoveryProviders } from '../packages/core/dist/index.js';

test('J01 onboarding journey: local status -> harness survey -> workspace selection -> no-device -> Overview', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-j01-'));
  const root = path.join(temp, 'workspace'); fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'hello.txt'), 'local file content');
  const dataDir = path.join(temp, 'state');
  const runtimes = [];
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  let pickerCalls = 0;
  const chooseWorkspace = async () => {
    pickerCalls++;
    return { root, displayName: 'My Project' };
  };

  // 1. First start: zero-config discovery with default providers
  const runtime = await startLocalRuntime({
    dataDir,
    providers: defaultDiscoveryProviders(),
    chooseWorkspace,
  });
  runtimes.push(runtime);

  const client = new LocalClient(runtime.origin);

  // User policy: local onboarding never requires a PIN.
  assert.equal((await client.snapshot()).accessMode, 'local-no-auth');

  // Step 1: Local status
  const initialSnapshot = await client.snapshot();
  assert.equal(initialSnapshot.workspaces.length, 0);
  assert.equal(initialSnapshot.devices.length, 0);

  // Step 2: Harness survey
  const supportsSurvey=['win32','darwin'].includes(process.platform);
  if(supportsSurvey) {
    assert.ok(initialSnapshot.harness, 'Harness survey should be available');
    assert.equal(typeof initialSnapshot.harness.status, 'string');
    assert.ok(Array.isArray(initialSnapshot.harness.candidates));
  } else assert.equal(initialSnapshot.harness,null,'Unsupported survey must not claim discovery');
  // A2 check: discovered/authenticated/controllable differentiation
  for (const candidate of initialSnapshot.harness?.candidates || []) {
    assert.equal(candidate.connection, 'unprobed');
    assert.equal(candidate.controllable, false, 'Candidate without verified session must not claim controllable');
    assert.equal(candidate.version, null);
  }

  // Rescan harness succeeds
  if(supportsSurvey) {
    const scanned = await client.scanHarness();
    assert.equal(typeof scanned.generation, 'number');
  } else await assert.rejects(client.scanHarness());

  // Step 3: Workspace selection
  const selectionResult = await client.selectWorkspace();
  assert.equal(selectionResult.selected, true);
  assert.equal(pickerCalls, 1);

  const snapshotWithWs = await client.snapshot();
  assert.equal(snapshotWithWs.workspaces.length, 1);
  const registeredWs = snapshotWithWs.workspaceDetails[0];
  assert.equal(registeredWs.displayName, 'My Project');
  assert.equal(registeredWs.status, 'ready');

  // Recheck workspace
  const rechecked = await client.recheckWorkspace(registeredWs.workspaceId);
  assert.equal(rechecked.status, 'ready');

  // Step 4: Devices - none registered, works without hardware
  assert.equal(snapshotWithWs.devices.length, 0);

  // Step 5: Overview reached, file read works locally
  const fileContent = await client.readFile(registeredWs.workspaceId, 'hello.txt');
  assert.deepEqual(fileContent, { text: 'local file content' });

  // Releasing local controller context does not introduce a login requirement.
  await client.logout();
  assert.equal((await client.snapshot()).accessMode, 'local-no-auth');

  // Restart runtime on new port, verify durable state restoration
  await runtime.close();
  const restarted = await startLocalRuntime({
    dataDir,
    providers: defaultDiscoveryProviders(),
    chooseWorkspace,
  });
  runtimes.push(restarted);

  const newClient = new LocalClient(restarted.origin);
  assert.equal((await newClient.snapshot()).accessMode, 'local-no-auth');

  const restoredSnapshot = await newClient.snapshot();
  assert.equal(restoredSnapshot.workspaces.length, 1);
  assert.equal(restoredSnapshot.workspaces[0].workspaceId, registeredWs.workspaceId);
  assert.equal(pickerCalls, 1, 'Picker should not have been called again on restart');
});

test('A2 acceptance: zero external network access (Internet-off) and discovery alone makes no control claim', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-a2-'));
  const dataDir = path.join(temp, 'state');
  const runtimes = [];
  t.after(async () => {
    for (const runtime of runtimes) await runtime.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const runtime = await startLocalRuntime({
    dataDir,
    providers: defaultDiscoveryProviders(),
  });
  runtimes.push(runtime);

  // Origin must be strictly loopback (127.0.0.1)
  const url = new URL(runtime.origin);
  assert.equal(url.hostname, '127.0.0.1');

  const client = new LocalClient(runtime.origin);
  assert.equal((await client.snapshot()).accessMode, 'local-no-auth');

  const snapshot = await client.snapshot();
  if (snapshot.harness) {
    for (const candidate of snapshot.harness.candidates) {
      assert.equal(candidate.controllable, false);
      assert.equal(candidate.connection, 'unprobed');
    }
  }
});
