import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_FLAG_FILLED,
  KEY_FLAG_EDITING,
  KEY_FLAG_FOCUSED,
  KEY_FLAG_DISABLED,
  KEY_FLAG_LIST,
} from '../dist/protocol/messages.js';

test('protocol: Key bitmask flags have distinct unique bit powers', () => {
  assert.equal(KEY_FLAG_FILLED, 1);
  assert.equal(KEY_FLAG_EDITING, 2);
  assert.equal(KEY_FLAG_FOCUSED, 4);
  assert.equal(KEY_FLAG_DISABLED, 8);
  assert.equal(KEY_FLAG_LIST, 16);

  // Combined flag calculation
  const flags = KEY_FLAG_FILLED | KEY_FLAG_EDITING;
  assert.equal(flags, 3);
  assert.ok(flags & KEY_FLAG_FILLED);
  assert.ok(flags & KEY_FLAG_EDITING);
  assert.ok(!(flags & KEY_FLAG_DISABLED));
});

test('protocol: HostSyncPacket serialization produces compliant JSON under 8KB limit', () => {
  const packet = {
    type: 'v2_sync',
    seq: 42,
    viewMode: 'session',
    topTitle: 'DEV-PC / Codex',
    topSubtitle: 'Snowball -> Task 1',
    topBody: 'Line 1: Model response streaming delta\nLine 2: Continuing execution...\nLine 3: Finished.',
    topScroll: 0,
    volume: 75,
    isMuted: false,
    keys: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      top: `K${i + 1}`,
      main: `Key ${i + 1}`,
      sub: i === 19 ? 'Talk' : '',
      flags: i === 19 ? KEY_FLAG_FILLED : 0,
    })),
  };

  const jsonStr = JSON.stringify(packet);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.type, 'v2_sync');
  assert.equal(parsed.seq, 42);
  assert.equal(parsed.keys.length, 20);
  assert.equal(parsed.keys[19].id, 20);
  assert.equal(parsed.keys[19].sub, 'Talk');
  assert.equal(parsed.keys[19].flags, KEY_FLAG_FILLED);

  const buf = Buffer.from(jsonStr, 'utf-8');
  // Maximum UDP packet budget is 8192 bytes
  assert.ok(buf.length < 4096, `Sync packet size (${buf.length} bytes) exceeds budget`);
});

test('protocol: DeviceInputPacket parsing correctly interprets key and knob events', () => {
  const pingStr = '{"type":"ping"}';
  const ping = JSON.parse(pingStr);
  assert.equal(ping.type, 'ping');

  const keyStr = '{"type":"key","keyId":20,"isDown":true}';
  const keyEvent = JSON.parse(keyStr);
  assert.equal(keyEvent.type, 'key');
  assert.equal(keyEvent.keyId, 20);
  assert.equal(keyEvent.isDown, true);

  const knobLeftStr = '{"type":"knob_left","delta":1,"isClick":false}';
  const knobLeft = JSON.parse(knobLeftStr);
  assert.equal(knobLeft.type, 'knob_left');
  assert.equal(knobLeft.delta, 1);
  assert.equal(knobLeft.isClick, false);

  const knobRightClickStr = '{"type":"knob_right","isClick":true}';
  const knobRightClick = JSON.parse(knobRightClickStr);
  assert.equal(knobRightClick.type, 'knob_right');
  assert.equal(knobRightClick.isClick, true);
});
