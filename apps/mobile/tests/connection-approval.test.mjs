import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConnection, isConnectionApprovalCurrent } from '../connection-approval.mjs';
import { VERIFIED_GATEWAY_CONNECTION_AVAILABLE } from '../connection-policy.mjs';

test('credential transmission stays disabled until the gateway itself can be verified', () => {
  assert.equal(VERIFIED_GATEWAY_CONNECTION_AVAILABLE, false);
});

test('only the exact address and credential confirmed for the current foreground draft remain approved', () => {
  const token = 'a'.repeat(43);
  const draft = { origin: 'https://pc.tailnet.ts.net', token, revision: 7, active: true };
  const approval = prepareConnection(draft.origin, draft.token, draft.revision);
  assert.equal(Object.isFrozen(approval), true);
  assert.equal(isConnectionApprovalCurrent(approval, draft), true);
  assert.equal(isConnectionApprovalCurrent(approval, { ...draft, origin: 'https://other.tailnet.ts.net' }), false);
  assert.equal(isConnectionApprovalCurrent(approval, { ...draft, token: 'b'.repeat(43) }), false);
  assert.equal(isConnectionApprovalCurrent(approval, { ...draft, revision: 8 }), false);
  assert.equal(isConnectionApprovalCurrent(approval, { ...draft, active: false }), false);
  assert.throws(() => prepareConnection('http://pc.tailnet.ts.net', token, 7));
});
