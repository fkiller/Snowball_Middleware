import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { RemoteReadGateway, PersistentRemoteCredentials, RemotePairingCoordinator, recoverAbandonedRemoteCredentialLock } from '../../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';
import { prepareGatewayIdentity } from './gateway-identity.mjs';

function findOpenSslExecutable() {
  for (const candidate of ['/usr/bin/openssl', '/opt/homebrew/bin/openssl', '/usr/local/bin/openssl']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const lookup = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['openssl'], { encoding: 'utf8', timeout: 5000 });
  if (lookup.status === 0 && typeof lookup.stdout === 'string') {
    const found = lookup.stdout.split(/\r?\n/).find(line => path.isAbsolute(line.trim()) && fs.existsSync(line.trim()));
    if (found) return found.trim();
  }
  return undefined;
}

function isPrivateIpv4(address) {
  if (typeof address !== 'string') return false;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function discoverGatewayEndpoints(port, tlsHost) {
  const endpoints = [];
  const seen = new Set();
  const add = url => {
    if (!seen.has(url)) {
      seen.add(url);
      endpoints.push(url);
    }
  };
  try {
    const interfaces = os.networkInterfaces();
    for (const [name, entries] of Object.entries(interfaces)) {
      if (!Array.isArray(entries)) continue;
      if (/^(lo|utun|tailscale|docker|br-|veth|vmnet|vboxnet)/i.test(name)) continue;
      for (const entry of entries) {
        if (entry && entry.family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address)) {
          add(`https://${entry.address}:${port}`);
        }
      }
    }
  } catch {
    // Ignore interface enumeration errors
  }
  if (typeof tlsHost === 'string' && tlsHost.endsWith('.ts.net') && !tlsHost.endsWith('.local.ts.net')) {
    add(`https://${tlsHost}`);
  }
  add(`https://127.0.0.1:${port}`);
  return endpoints;
}

// Owned by the local runtime, called only by its native parent process or loopback LocalApi.
export class RemoteManager {
  #gateway; #store; #pairing; #tlsIdentity; #closed = false; #tail = Promise.resolve();
  constructor({ directory, sessionService, hostId, hostname, onStateChange }) {
    this.directory = path.join(directory, 'remote');
    this.sessionService = sessionService;
    this.hostId = hostId;
    this.hostname = hostname;
    this.onStateChange = onStateChange;
  }
  #run(action) {
    const result = this.#tail.then(() => { if (this.#closed) throw Error('remote_closed'); return action(); });
    this.#tail = result.catch(() => {});
    return result;
  }
  #openStore() {
    return this.#store ??= new PersistentRemoteCredentials({directory:this.directory, verifyPrivateDirectory:ensurePrivateStateDirectory});
  }
  #openPairing() {
    return this.#pairing ??= new RemotePairingCoordinator({
      directory: ensurePrivateStateDirectory(this.directory, ['paired-devices.v1.json']),
      onChange: () => this.onStateChange?.(),
    });
  }
  #view() {
    return { enabled:!!this.#gateway, origin:this.#gateway?.origin ?? null, credentials:this.#store?.list() ?? null };
  }
  describe() {
    if (!this.#pairing && fs.existsSync(path.join(this.directory, 'paired-devices.v1.json'))) {
      try { this.#openPairing(); } catch {}
    }
    const port = this.#gateway?.origin ? Number(new URL(this.#gateway.origin).port) : null;
    const endpoints = port && this.#tlsIdentity ? discoverGatewayEndpoints(port, this.#tlsIdentity.host) : [];
    return {
      enabled: !!this.#gateway && !!this.#tlsIdentity,
      origin: this.#gateway?.origin ?? null,
      host: this.#tlsIdentity?.host ?? null,
      fingerprint: this.#tlsIdentity?.fingerprint ?? null,
      endpoints,
      activeInvitation: this.#pairing?.getActiveInvitation() ?? null,
      pendingRequests: this.#pairing?.listPendingRequests() ?? [],
      pairedDevices: this.#pairing?.listPairedDevices() ?? [],
    };
  }
  status() { return this.#run(() => this.#view()); }
  list() { return this.#run(() => { this.#openStore(); return this.#view(); }); }
  enable() { return this.#run(async () => {
    if (this.#gateway) return this.#view();
    const gateway = new RemoteReadGateway({sessionService:this.sessionService, credentialStore:this.#openStore()});
    try { await gateway.start(); this.#gateway = gateway; }
    catch(error) { await gateway.close(); throw error; }
    this.onStateChange?.();
    return this.#view();
  }); }
  enableTls({ host, openssl, bindAddress = '0.0.0.0' } = {}) { return this.#run(async () => {
    if (this.#gateway) throw Error('remote_already_enabled');
    const identity = prepareGatewayIdentity({directory:path.join(this.directory,'tls-identity'),host,openssl});
    const gateway = new RemoteReadGateway({
      sessionService:this.sessionService,
      credentialStore:this.#openStore(),
      pairing:this.#openPairing(),
      tls:identity.tlsOptions(),
      bindAddress,
    });
    try { await gateway.start(); this.#gateway = gateway; this.#tlsIdentity = identity; }
    catch(error) { await gateway.close(); throw error; }
    this.onStateChange?.();
    return { ...this.#view(), host:identity.host, fingerprint:identity.fingerprint };
  }); }
  startPairing() { return this.#run(async () => {
    if (this.#gateway && !this.#tlsIdentity) {
      const old = this.#gateway; this.#gateway = undefined;
      await old.close();
    }
    if (!this.#gateway) {
      const tlsDir = path.join(this.directory, 'tls-identity');
      const existingFile = path.join(tlsDir, 'gateway-tls-identity.v1.json');
      let host;
      if (fs.existsSync(existingFile)) {
        try { host = JSON.parse(fs.readFileSync(existingFile, 'utf8'))?.host; } catch {}
      }
      if (!host) {
        const safeLabel = String(this.hostId || 'snowball-pc').replace(/[^a-z0-9-]/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'snowball-pc';
        host = `${safeLabel}.local.ts.net`;
      }
      const openssl = findOpenSslExecutable();
      const identity = prepareGatewayIdentity({ directory: tlsDir, host, openssl });
      const gateway = new RemoteReadGateway({
        sessionService: this.sessionService,
        credentialStore: this.#openStore(),
        pairing: this.#openPairing(),
        tls: identity.tlsOptions(),
        bindAddress: '0.0.0.0',
      });
      try { await gateway.start(); this.#gateway = gateway; this.#tlsIdentity = identity; }
      catch (error) { await gateway.close(); throw error; }
    }
    const port = Number(new URL(this.#gateway.origin).port);
    const endpoints = discoverGatewayEndpoints(port, this.#tlsIdentity.host);
    const pcName = (this.hostname || os.hostname() || 'Snowball PC').replace(/\.local$/i, '');
    return this.#openPairing().createInvitation({
      pcName,
      tlsServerName: this.#tlsIdentity.host,
      fingerprint: this.#tlsIdentity.fingerprint,
      endpoints,
    });
  }); }
  approvePairing(pairingId) { return this.#run(() => {
    const result = this.#openPairing().approvePairing(pairingId);
    this.onStateChange?.();
    return result;
  }); }
  rejectPairing(pairingId) { return this.#run(() => {
    this.#openPairing().rejectPairing(pairingId);
    this.onStateChange?.();
    return this.describe();
  }); }
  revokeDevice(deviceId) { return this.#run(() => {
    if (typeof deviceId !== 'string') throw Error('invalid_device');
    if (deviceId.startsWith('dev_')) {
      this.#openPairing().revokeDevice(deviceId);
      this.#gateway?.revokeCredential(deviceId);
    } else if (/^remote_[a-f0-9]{32}$/.test(deviceId)) {
      this.#openStore().revoke(deviceId);
      this.#gateway?.revokeCredential(deviceId);
    } else {
      throw Error('invalid_device');
    }
    this.onStateChange?.();
    return this.describe();
  }); }
  disable() { return this.#run(async () => {
    const gateway = this.#gateway; this.#gateway = undefined; this.#tlsIdentity = undefined;
    if (gateway) await gateway.close();
    this.onStateChange?.();
    return this.#view();
  }); }
  issue() { return this.#run(() => {
    if (!this.#gateway) throw Error('remote_disabled');
    return this.#gateway.issueReadCredential();
  }); }
  revoke(deviceId) { return this.#run(() => {
    if (typeof deviceId !== 'string' || !/^remote_[a-f0-9]{32}$/.test(deviceId)) throw Error('invalid_device');
    this.#openStore().revoke(deviceId);
    return this.#view();
  }); }
  recoverLock() { return this.#run(() => {
    // Explicit local maintenance only. Never interfere with a live gateway or
    // this runtime's existing store, even when its integrity is unavailable.
    if (this.#gateway || this.#store) throw Error('remote_in_use');
    const directory = ensurePrivateStateDirectory(this.directory, ['remote-credentials.v1.json', 'remote-credentials.lock', 'remote-credentials.guard']);
    const lockPath = path.join(directory, 'remote-credentials.lock');
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw Error('invalid_remote_lock');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!lock || typeof lock !== 'object' || typeof lock.token !== 'string') throw Error('invalid_remote_lock');
    // The recovery helper serializes against all writers and rechecks both the
    // captured token and the PID before removing the abandoned lock.
    recoverAbandonedRemoteCredentialLock({directory, expectedToken:lock.token, verifyPrivateDirectory:ensurePrivateStateDirectory});
    this.#openStore();
    return this.#view();
  }); }
  close() {
    const result = this.#tail.then(async () => {
      if (this.#closed) return;
      this.#closed = true;
      const gateway = this.#gateway; this.#gateway = undefined; this.#tlsIdentity = undefined;
      try { if (gateway) await gateway.close(); } finally { this.#store?.close(); }
    });
    this.#tail = result.catch(() => {});
    return result;
  }
}

// Reject malformed IPC before dispatch and never put exception messages in IPC.
export async function handleRemoteControl(manager, message) {
  if (!message || message.kind !== 'remote-control' || !Number.isSafeInteger(message.id) || message.id < 1 ||
      !['status','list','enable','disable','issue','revoke','recoverLock'].includes(message.action) ||
      Object.keys(message).some(k => !['kind','id','action','deviceId'].includes(k)) ||
      (message.action !== 'revoke' && message.deviceId !== undefined)) return undefined;
  try {
    const value = message.action === 'revoke' ? await manager.revoke(message.deviceId) : await manager[message.action]();
    return {kind:'remote-result', id:message.id, ok:true, value};
  } catch { return {kind:'remote-result', id:message.id, ok:false}; }
}

// Begin remote shutdown independently of device cleanup, which may take a long
// time. A failure in either component must not suppress the other's cleanup.
export async function closeRemoteAndDevice(manager, closeDevice) {
  const remoteClosing = Promise.resolve().then(() => manager?.close());
  const deviceClosing = Promise.resolve().then(() => closeDevice());
  await Promise.allSettled([remoteClosing, deviceClosing]);
}
