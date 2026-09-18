/** Provider observations are evidence, not enrollment or an owner/control grant. */
export interface ProbeObservation {
  presence: 'unknown' | 'installed' | 'running' | 'history_only' | 'absent';
  compatibility: 'unknown' | 'supported' | 'unsupported' | 'wrong_service';
  auth: 'unknown' | 'not_required' | 'authenticated' | 'required';
  permission: 'unknown' | 'granted' | 'denied';
  connectivity: 'unknown' | 'reachable' | 'offline';
  /** A protocol advertisement alone is not proof of control ownership. */
  advertisedControl: boolean;
}
export type ProbeReason = 'needs_permission' | 'wrong_service' | 'unsupported' | 'needs_auth' | 'readonly_history' | 'not_installed' | 'not_running' | 'offline' | 'unverified' | 'compatible';
export interface ProbeAssessment extends ProbeObservation {
  reason: ProbeReason;
  control: 'unverified';
  enrollment: 'unregistered';
  controllable: false;
}
/** Orthogonal facts remain available even when one remediation reason takes priority. */
export function assessProbe(value: ProbeObservation): ProbeAssessment {
  const enums = {
    presence: ['unknown', 'installed', 'running', 'history_only', 'absent'],
    compatibility: ['unknown', 'supported', 'unsupported', 'wrong_service'],
    auth: ['unknown', 'not_required', 'authenticated', 'required'],
    permission: ['unknown', 'granted', 'denied'],
    connectivity: ['unknown', 'reachable', 'offline'],
  };
  if (!value || typeof value !== 'object' || typeof value.advertisedControl !== 'boolean') throw new Error('invalid_probe_observation');
  for (const [key, values] of Object.entries(enums)) if (!values.includes(value[key as keyof typeof enums])) throw new Error('invalid_probe_observation');
  const { presence, compatibility, auth, permission, connectivity, advertisedControl } = value;
  const reason: ProbeReason = permission === 'denied' ? 'needs_permission'
    : compatibility === 'wrong_service' ? 'wrong_service'
    : compatibility === 'unsupported' ? 'unsupported'
    : auth === 'required' ? 'needs_auth'
    : presence === 'history_only' ? 'readonly_history'
    : presence === 'absent' ? 'not_installed'
    : presence === 'installed' && connectivity !== 'reachable' ? 'not_running'
    : connectivity === 'offline' ? 'offline'
    : compatibility === 'supported' && connectivity === 'reachable' && permission === 'granted' && (auth === 'authenticated' || auth === 'not_required') && presence === 'running' ? 'compatible'
    : 'unverified';
  return { presence, compatibility, auth, permission, connectivity, advertisedControl, reason, control: 'unverified', enrollment: 'unregistered', controllable: false };
}
