import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HidDiscovery, loadNativeBackend } from '../packages/device-hid/dist/index.js';
import { reviewedProfiles } from '../packages/device-hid/dist/profiles.js';

test('MW.04.01.01.02.A1: real physical MK20 QMK HID enumeration and safe-test lifecycle', async t => {
  assert.ok(reviewedProfiles.length > 0, 'reviewedProfiles must not be empty');
  const mk20Profile = reviewedProfiles.find(p => p.id === 'mk20-qmk-controller');
  assert.ok(mk20Profile, 'mk20-qmk-controller profile must be registered');
  assert.equal(mk20Profile.vendorId, 0x4250);
  assert.equal(mk20Profile.productId, 0x426f);

  const backend = loadNativeBackend();
  const discovery = new HidDiscovery(backend, reviewedProfiles);
  t.after(async () => { await discovery.close(); });

  const scan = await discovery.scan();
  assert.equal(scan.status, 'complete');
  assert.deepEqual(scan.issues, []);
  assert.ok(scan.candidates.length >= 1, 'Must find physical MK20 QMK candidate');

  const candidate = scan.candidates.find(c => c.profileId === 'mk20-qmk-controller');
  assert.ok(candidate, 'Candidate must match mk20-qmk-controller');
  assert.equal(candidate.vendorId, 16976);
  assert.equal(candidate.productId, 17007);
  assert.equal(candidate.usagePage, 65329);
  assert.equal(candidate.usage, 116);
  assert.equal(candidate.interface, 3);
  assert.equal(candidate.identity, 'physical_confirmation_required');

  // Begin real safe test on physical handle
  const safeTest = await discovery.beginSafeTest(candidate.candidateId, scan.generation);
  assert.equal(safeTest.isOpen, true);
  const status = safeTest.status();
  assert.equal(status.state, 'waiting_neutral');
  assert.equal(status.candidateId, candidate.candidateId);

  // Close safe test cleanly
  await safeTest.close();
  assert.equal(safeTest.isOpen, false);
});

test('MW.04.01.01.02.A2: typing/mouse collections are strictly excluded from HID catalog', async () => {
  const mk20Profile = reviewedProfiles.find(p => p.id === 'mk20-qmk-controller');
  for (const selector of mk20Profile.selectors) {
    // Ensure vendor usage page (0xFF00 - 0xFFFF)
    assert.ok(selector.usagePage >= 0xff00 && selector.usagePage <= 0xffff, 'Must be vendor usage page');
    assert.notEqual(selector.usagePage, 1, 'Generic Desktop (keyboard/mouse) must never be selected');
    assert.notEqual(selector.usagePage, 12, 'Consumer Control must never be selected');
  }
});
