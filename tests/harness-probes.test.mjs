import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessProbe } from '../packages/core/dist/index.js';
const good = { presence: 'running', compatibility: 'supported', auth: 'not_required', permission: 'granted', connectivity: 'reachable', advertisedControl: true };
test('probe facts never enroll a candidate or grant control even with compatible advertisements', () => {
  const result = assessProbe({ ...good, controllable: true, enrollment: 'registered', secret: 'not copied' });
  assert.equal(result.reason, 'compatible'); assert.equal(result.controllable, false); assert.equal(result.control, 'unverified'); assert.equal(result.enrollment, 'unregistered'); assert.ok(!('secret' in result));
  for (const patch of [{ compatibility: 'unknown' }, { auth: 'unknown' }, { permission: 'unknown' }, { presence: 'unknown' }]) assert.equal(assessProbe({ ...good, ...patch }).reason, 'unverified');
});
test('authentication, installation, history and owner absence remain independent facts', () => {
  assert.equal(assessProbe({ ...good, auth: 'required' }).reason, 'needs_auth');
  assert.equal(assessProbe({ ...good, presence: 'installed', connectivity: 'offline' }).reason, 'not_running');
  const history = assessProbe({ ...good, presence: 'history_only', connectivity: 'offline' }); assert.equal(history.reason, 'readonly_history'); assert.equal(history.connectivity, 'offline'); assert.equal(history.controllable, false);
  assert.equal(assessProbe({ ...good, presence: 'absent', connectivity: 'offline' }).reason, 'not_installed');
  assert.equal(assessProbe({ ...good, permission: 'denied', auth: 'required' }).reason, 'needs_permission');
  assert.equal(assessProbe({ ...good, compatibility: 'wrong_service', auth: 'required' }).reason, 'wrong_service');
  assert.equal(assessProbe({ ...good, compatibility: 'unsupported' }).reason, 'unsupported');
  assert.throws(() => assessProbe({ ...good, compatibility: 'probably_ok' }), /invalid_probe_observation/);
});
