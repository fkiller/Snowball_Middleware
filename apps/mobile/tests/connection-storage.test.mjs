import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionStorage } from '../connection-storage.mjs';

test('a verified save is readable by a new storage instance after restart', async () => {
  let value = null;
  const backend = {
    get: async () => value,
    set: async next => { value = next; },
    remove: async () => { value = null; },
  };
  assert.equal(await createConnectionStorage(backend).save('host-and-credential'), true);
  assert.equal(await createConnectionStorage(backend).load(), 'host-and-credential');
});

test('a write that resolves without persisting is not reported as saved', async () => {
  let value = null;
  let removals = 0;
  const storage = createConnectionStorage({
    get: async () => value,
    set: async () => {},
    remove: async () => { value = null; removals++; },
  });
  await assert.rejects(storage.save('host-and-credential'), /could not be verified/);
  assert.equal(removals, 1);
  assert.equal(await storage.load(), null);
});

test('forgetting while readback is pending removes the credential and invalidates the save', async () => {
  let value = null;
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const storage = createConnectionStorage({
    get: async () => { started(); await waiting; return value; },
    set: async next => { value = next; },
    remove: async () => { value = null; },
  });
  const save = storage.save('old-host-and-token');
  await startedPromise;
  const clear = storage.clear();
  release();
  assert.equal(await save, false);
  await clear;
  assert.equal(value, null);
});

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
