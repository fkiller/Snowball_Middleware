import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionStorage } from '../connection-storage.mjs';

test('changing or forgetting an address prevents a late secure-store save from restoring its credential', async () => {
  let value = null;
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const storage = createConnectionStorage({
    get: async () => value,
    set: async next => { started(); await waiting; value = next; },
    remove: async () => { value = null; },
  });
  const save = storage.save('old-host-and-token');
  await startedPromise;
  const clear = storage.clear();
  release();
  assert.equal(await save, false);
  await clear;
  assert.equal(await storage.load(), null);
  assert.equal(value, null);
});

test('a failed removal is surfaced and later explicit removal can recover', async () => {
  let value = 'old';
  let fail = true;
  const storage = createConnectionStorage({
    get: async () => value,
    set: async next => { value = next; },
    remove: async () => { if (fail) throw new Error('unavailable'); value = null; },
  });
  await assert.rejects(storage.clear(), /unavailable/);
  fail = false;
  await storage.clear();
  assert.equal(await storage.load(), null);
});
