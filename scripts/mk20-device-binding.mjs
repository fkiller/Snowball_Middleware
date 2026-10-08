import {privateIpv4} from './setup-profile.mjs';

// Called only after an MK20 SELECT has passed the LAN lease/identity checks.
// Registration survives runtime disposal; a new selection explicitly reconnects
// the same physical identity instead of creating a second controller.
export function connectMk20Device(registry, {targetAddress, deviceId}) {
  if (!privateIpv4(targetAddress) || !/^mk20-[a-f0-9]{12}$/.test(deviceId)) throw Error('Invalid MK20 LAN identity');
  const source = {pluginId: 'plugin.mk20', instanceId: 'desk-terminal'};
  const identity = 'mk20-mac-' + deviceId.slice(5).match(/../g).join(':');
  const generation = registry.beginScan(source);
  const candidate = registry.observe(source, generation, {
    nativeDeviceId: `mk20-lan-${targetAddress}:7701`,
    label: `MK20 Smart Desk Terminal (${targetAddress}:7701)`,
    transport: 'lan', capabilities: ['button', 'select-session', 'display'],
    supported: true, verifiedIdentity: identity,
  });
  registry.finishScan(source, generation, 'ready');
  if (!candidate) throw Error('MK20 LAN candidate became stale');
  const previous = registry.list().find(binding => binding.source.pluginId === source.pluginId &&
    binding.source.instanceId === source.instanceId && binding.verifiedIdentity === identity);
  const {binding} = previous
    ? registry.reconnect(previous.deviceId, candidate.candidateId, generation, previous.revision)
    : registry.register(candidate.candidateId, generation);
  let released = false;
  return {binding, reconnected: Boolean(previous), release() {
    if (released) return; released = true;
    // A slow old runtime must never mark its replacement offline.
    if (registry.list().some(current => current.deviceId === binding.deviceId && current.revision === binding.revision)) registry.disconnect(binding.deviceId);
  }};
}
