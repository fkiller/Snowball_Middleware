import path from 'node:path';
import fs from 'node:fs';
import { RemoteReadGateway, PersistentRemoteCredentials, recoverAbandonedRemoteCredentialLock } from '../../packages/api/dist/index.js';
import { ensurePrivateStateDirectory } from './private-state.mjs';

// Owned by the local runtime, called only by its native parent process. No HTTP
// route exposes these methods. The gateway stays off after every process restart.
export class RemoteManager {
  #gateway; #store; #closed = false; #tail = Promise.resolve();
  constructor({ directory, sessionService }) {
    this.directory = path.join(directory, 'remote');
    this.sessionService = sessionService;
  }
  #run(action) {
    const result = this.#tail.then(() => { if (this.#closed) throw Error('remote_closed'); return action(); });
    this.#tail = result.catch(() => {});
    return result;
  }
  #openStore() {
    return this.#store ??= new PersistentRemoteCredentials({directory:this.directory, verifyPrivateDirectory:ensurePrivateStateDirectory});
  }
  #view() {
    return { enabled:!!this.#gateway, origin:this.#gateway?.origin ?? null, credentials:this.#store?.list() ?? null };
  }
  status() { return this.#run(() => this.#view()); }
  list() { return this.#run(() => { this.#openStore(); return this.#view(); }); }
  enable() { return this.#run(async () => {
    if (this.#gateway) return this.#view();
    const gateway = new RemoteReadGateway({sessionService:this.sessionService, credentialStore:this.#openStore()});
    try { await gateway.start(); this.#gateway = gateway; }
    catch(error) { await gateway.close(); throw error; }
    return this.#view();
  }); }
  disable() { return this.#run(async () => {
    const gateway = this.#gateway; this.#gateway = undefined;
    if (gateway) await gateway.close();
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
      const gateway = this.#gateway; this.#gateway = undefined;
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
