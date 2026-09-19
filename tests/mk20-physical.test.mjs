import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatibility, requireProductionControl, decodeLegacyInput, encodeLegacyPreview, Mk20LabTransport } from '../../Snowball_Control/plugins/device-mk20/src/index.mjs';

test('MW.04.02.01.02.A1: real physical MK20 independent device network preview and pairing boundary', async t => {
  // Verify adapter compatibility
  const compat = compatibility();
  assert.equal(compat.model, 'MK20');
  assert.equal(compat.protocol, 'legacy-udp-v2');
  assert.equal(compat.controllable, false, 'Unauthenticated legacy device cannot have production control');
  assert.equal(compat.canMergeUsbLan, false, 'USB and LAN identities remain unmerged without verified pairing');

  // Verify real physical UDP preview transmission to live MK20 at 192.168.1.248:7701
  const transport = new Mk20LabTransport({
    labEnabled: true,
    localAddress: '192.168.1.225',
    targetAddress: '192.168.1.248',
    targetPort: 7701
  });
  t.after(async () => { await transport.close(); });

  await transport.start();

  const previewResult = await transport.preview({
    title: 'Snowball Middleware',
    subtitle: 'MK20 Physical Test',
    lines: ['Connected via UDP 7701', 'Physical Acceptance Verification'],
    scroll: 0,
    totalLines: 2,
    volume: 50,
    muted: false,
    keys: [{ id: 1, top: 'MW.04.02', main: 'PASS', flags: 1 }]
  });

  assert.equal(previewResult.delivery, 'unacknowledged_lab');
  assert.ok(previewResult.sentBytes > 0, 'Must transmit bytes to physical MK20 device');

  await transport.close();
});

test('MW.04.02.01.02.A2: production control fail-closed requirement and bounded legacy decoding', () => {
  assert.throws(() => requireProductionControl({ authenticated: true }), /authenticated_firmware_required/);

  const packet = Buffer.from(JSON.stringify({ type: 'key', keyId: 1, isDown: true, seq: 10 }));
  const decoded = decodeLegacyInput(packet);
  assert.equal(decoded.kind, 'button');
  assert.equal(decoded.button, 'key-1');
  assert.equal(decoded.trust, 'untrusted_lab');
});
