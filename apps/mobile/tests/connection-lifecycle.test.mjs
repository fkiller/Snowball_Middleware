import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionLifecycle } from '../connection-lifecycle.mjs';

test('background or forgotten connections cancel pending work and cannot publish a late response', async () => {
  const lifecycle = createConnectionLifecycle();
  const attempt = lifecycle.begin();
  let finishResponse;
  const ignoredCancellation = new Promise(resolve => { finishResponse = resolve; });
  const published = [];
  const task = ignoredCancellation.then(value => { if (attempt.isCurrent()) published.push(value); });
  lifecycle.invalidate();
  assert.equal(attempt.signal.aborted, true);
  finishResponse('old snapshot');
  await task;
  assert.deepEqual(published, []);
});

test('a late completion cannot replace a newer attempt or invalidate it during cleanup', () => {
  const lifecycle = createConnectionLifecycle();
  const first = lifecycle.begin();
  const second = lifecycle.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  first.finish();
  assert.equal(second.isCurrent(), true);
  lifecycle.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});
