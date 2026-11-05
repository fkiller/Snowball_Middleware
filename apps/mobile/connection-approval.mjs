import { validateOrigin, validateToken } from './remote.mjs';
import { validateFingerprint } from './pinned-remote.mjs';

// Capture the exact address and credential shown in the confirmation prompt.
// Neither a later edit nor a background/foreground cycle may reuse approval.
export function prepareConnection(origin, token, revision, fingerprint) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid connection revision');
  return Object.freeze({ origin: validateOrigin(origin), token: validateToken(token), fingerprint: validateFingerprint(fingerprint), revision });
}

export function isConnectionApprovalCurrent(approval, draft) {
  if (!approval || !draft || !draft.active || approval.revision !== draft.revision) return false;
  try {
    return approval.origin === validateOrigin(draft.origin) && approval.token === validateToken(draft.token) &&
      approval.fingerprint === validateFingerprint(draft.fingerprint);
  } catch { return false; }
}
