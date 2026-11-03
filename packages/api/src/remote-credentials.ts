import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

type RecordV1 = { deviceId: string; label: string; tokenHash: string; issuedAt: number; expiresAt: number };
export type RemoteCredentialInfo = Omit<RecordV1, 'tokenHash'>;
const DATA = 'remote-credentials.v1.json';
const LOCK = 'remote-credentials.lock';
const GUARD = 'remote-credentials.guard';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const MAX_LIFETIME = 8 * 60 * 60 * 1000;

// Both initial lock acquisition and explicit recovery must hold the same
// cross-process guard. A missing process can otherwise be replaced between a
// recovery check and unlink, allowing the new owner's lock to be removed.
// If a process dies while holding this short-lived guard, fail closed rather
// than guessing that the guard can safely be deleted.
function acquireLockGuard(directory: string): () => void {
  const guardPath = path.join(directory, GUARD);
  const token = randomUUID();
  // Do not block the local control event loop while another owner has a guard.
  // The caller may explicitly retry; never remove an unverified guard.
  const fd = fs.openSync(guardPath, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ token, pid: process.pid })); }
  catch (error) { fs.closeSync(fd); fs.unlinkSync(guardPath); throw error; }
  fs.closeSync(fd);
  return () => {
    const stat = fs.lstatSync(guardPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('Credential lock guard invalid');
    const guard: unknown = JSON.parse(fs.readFileSync(guardPath, 'utf8'));
    if (!plainObject(guard) || guard.token !== token || guard.pid !== process.pid) throw new Error('Credential lock guard ownership changed');
    fs.unlinkSync(guardPath);
  };
}

/**
 * Local, single-writer storage for experimental bearer credentials. This is not
 * pairing or proof of possession of a device key. The caller MUST verify the OS
 * owner/permissions/ACL of this private directory and the named files before
 * returning from verifyPrivateDirectory. Store only hashes, never bearer tokens.
 */
export class PersistentRemoteCredentials {
  private readonly directory: string;
  private readonly dataPath: string;
  private readonly lockPath: string;
  private readonly lockToken = randomUUID();
  private records: RecordV1[] = [];
  private encoded = '';
  private closed = false;
  private poisoned = false;
  private readonly now: () => number;
  private readonly verifyPrivateDirectory: (directory: string, names: string[]) => string;

  constructor(options: { directory: string; verifyPrivateDirectory: (directory: string, names: string[]) => string; now?: () => number }) {
    if (!path.isAbsolute(options.directory) || typeof options.verifyPrivateDirectory !== 'function') throw new Error('Verified private credential directory required');
    this.verifyPrivateDirectory = options.verifyPrivateDirectory;
    this.directory = this.verifyPrivateDirectory(options.directory, [DATA, LOCK, GUARD]);
    if (!path.isAbsolute(this.directory)) throw new Error('Invalid private credential directory');
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid private credential directory');
    this.dataPath = path.join(this.directory, DATA);
    this.lockPath = path.join(this.directory, LOCK);
    this.now = options.now ?? Date.now;
    const releaseGuard = acquireLockGuard(this.directory);
    try {
      this.verifyPrivateDirectory(this.directory, [DATA, LOCK, GUARD]);
      const fd = fs.openSync(this.lockPath, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ version: 2, token: this.lockToken, pid: process.pid })); fs.fsyncSync(fd); }
      catch (error) { fs.closeSync(fd); fs.unlinkSync(this.lockPath); throw error; }
      fs.closeSync(fd);
    } finally { releaseGuard(); }
    try {
      if (fs.existsSync(this.dataPath)) {
        this.encoded = this.readExisting();
        this.records = this.decode(this.encoded);
      } else {
        this.encoded = this.encode([]);
        this.replace(this.encoded);
      }
      this.verifyPrivateDirectory(this.directory, [DATA, LOCK]);
    } catch (error) { this.removeOwnLock(); throw error; }
  }

  private assertOpen(): void { if (this.closed || this.poisoned) throw new Error('Credential store unavailable'); }
  private readExisting(): string {
    const stat = fs.lstatSync(this.dataPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error('Credential store invalid');
    return fs.readFileSync(this.dataPath, 'utf8');
  }
  private encode(records: RecordV1[]): string {
    const payload = JSON.stringify({ version: 1, records });
    return JSON.stringify({ payload, checksum: digest(payload) }) + '\n';
  }
  private decode(encoded: string): RecordV1[] {
    try {
      const envelope: unknown = JSON.parse(encoded);
      if (!plainObject(envelope) || Object.keys(envelope).sort().join(',') !== 'checksum,payload' || typeof envelope.payload !== 'string' || typeof envelope.checksum !== 'string' || digest(envelope.payload) !== envelope.checksum) throw new Error();
      const data: unknown = JSON.parse(envelope.payload);
      if (!plainObject(data) || data.version !== 1 || Object.keys(data).sort().join(',') !== 'records,version' || !Array.isArray(data.records) || data.records.length > 16) throw new Error();
      const ids = new Set<string>(); const hashes = new Set<string>();
      for (const item of data.records) {
        if (!plainObject(item) || Object.keys(item).sort().join(',') !== 'deviceId,expiresAt,issuedAt,label,tokenHash' || typeof item.deviceId !== 'string' || !/^remote_[a-f0-9]{32}$/.test(item.deviceId) || typeof item.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.tokenHash) || typeof item.label !== 'string' || !validLabel(item.label) || !Number.isSafeInteger(item.issuedAt) || !Number.isSafeInteger(item.expiresAt) || Number(item.issuedAt) < 0 || Number(item.expiresAt) <= Number(item.issuedAt) || Number(item.expiresAt) - Number(item.issuedAt) > MAX_LIFETIME || ids.has(item.deviceId) || hashes.has(item.tokenHash)) throw new Error();
        ids.add(item.deviceId); hashes.add(item.tokenHash);
      }
      return data.records as RecordV1[];
    } catch { throw new Error('Credential store corrupt or unsupported'); }
  }
  private replace(encoded: string): void {
    const temp = path.join(this.directory, `remote-credentials-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, encoded); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.dataPath);
      if (process.platform !== 'win32') {
        const directoryFd = fs.openSync(this.directory, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      }
    } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  }
  private commit(records: RecordV1[]): void {
    this.assertOpen();
    try {
      this.checkIntegrity();
      const encoded = this.encode(records);
      this.replace(encoded);
      this.verifyPrivateDirectory(this.directory, [DATA, LOCK]);
      this.encoded = encoded; this.records = records;
    } catch (error) { this.poisoned = true; throw error; }
  }
  private checkIntegrity(): void {
    try {
      const lock: unknown = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      if (!plainObject(lock) || lock.version !== 2 || lock.token !== this.lockToken || this.readExisting() !== this.encoded) throw new Error('Credential store changed outside its owner');
    } catch (error) { this.poisoned = true; throw error; }
  }
  issue(label = 'Remote device'): { deviceId: string; token: string; expiresAt: number } {
    this.assertOpen();
    if (!validLabel(label)) throw new Error('Invalid device label');
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + MAX_LIFETIME)) throw new Error('Invalid clock');
    const records = this.records.filter(record => record.expiresAt > now);
    if (records.length >= 16) throw new Error('Credential capacity reached');
    const token = randomBytes(32).toString('base64url');
    const record = { deviceId: `remote_${randomBytes(16).toString('hex')}`, label, tokenHash: digest(token), issuedAt: now, expiresAt: now + MAX_LIFETIME };
    this.commit([...records, record]);
    return { deviceId: record.deviceId, token, expiresAt: record.expiresAt };
  }
  authenticate(tokenHash: string, now: number): { deviceId: string } | undefined {
    this.assertOpen();
    const record = this.records.find(entry => entry.tokenHash === tokenHash && entry.issuedAt <= now && entry.expiresAt > now);
    if (!record) return undefined;
    // Only recognized, unexpired tokens trigger a synchronous integrity read;
    // arbitrary invalid-token traffic cannot force disk I/O for each request.
    this.checkIntegrity();
    return { deviceId: record.deviceId };
  }
  list(): RemoteCredentialInfo[] {
    this.assertOpen(); this.checkIntegrity(); const now = this.now();
    return this.records.filter(record => record.issuedAt <= now && record.expiresAt > now).map(({ deviceId, label, issuedAt, expiresAt }) => ({ deviceId, label, issuedAt, expiresAt }));
  }
  revoke(deviceId: string): void {
    this.assertOpen();
    if (!/^remote_[a-f0-9]{32}$/.test(deviceId)) throw new Error('Invalid device ID');
    this.commit(this.records.filter(record => record.deviceId !== deviceId));
  }
  private removeOwnLock(): void {
    const releaseGuard = acquireLockGuard(this.directory);
    try {
      this.verifyPrivateDirectory(this.directory, [DATA, LOCK, GUARD]);
      const lock: unknown = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      if (!plainObject(lock) || lock.version !== 2 || lock.token !== this.lockToken || lock.pid !== process.pid) throw new Error('Credential lock ownership changed');
      fs.unlinkSync(this.lockPath);
    } finally { releaseGuard(); }
  }
  close(): void {
    if (this.closed) return;
    this.removeOwnLock();
    this.closed = true;
  }
}

function validLabel(label: string): boolean {
  return label.length > 0 && label.length <= 64 && label === label.trim() && !/[\u0000-\u001f\u007f]/.test(label);
}

/**
 * Explicit local maintenance only after a crash. Never call from a remote
 * endpoint or automatically delete a lock whose owner may still be running.
 */
export function recoverAbandonedRemoteCredentialLock(options: { directory: string; expectedToken: string; verifyPrivateDirectory: (directory: string, names: string[]) => string }): void {
  if (!path.isAbsolute(options.directory) || typeof options.expectedToken !== 'string' || !/^[a-f0-9-]{36}$/.test(options.expectedToken) || typeof options.verifyPrivateDirectory !== 'function') throw new Error('Invalid credential lock recovery request');
  const directory = options.verifyPrivateDirectory(options.directory, [DATA, LOCK, GUARD]);
  const lockPath = path.join(directory, LOCK);
  const read = (): { token: string; pid: number } => {
    const stat = fs.lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('Invalid credential lock');
    const data: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    // Version 1 was written by binaries that do not cooperate with the guard.
    // Never automatically recover those locks as if this protocol protected them.
    if (!plainObject(data) || data.version !== 2 || data.token !== options.expectedToken || !Number.isSafeInteger(data.pid) || Number(data.pid) <= 0) throw new Error('Credential lock metadata mismatch or unsupported version');
    return { token: data.token, pid: Number(data.pid) };
  };
  const releaseGuard = acquireLockGuard(directory);
  try {
    options.verifyPrivateDirectory(directory, [DATA, LOCK, GUARD]);
    const lock = read();
    try { process.kill(lock.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('Cannot prove credential lock owner has stopped');
      const current = read();
      if (current.token !== lock.token || current.pid !== lock.pid) throw new Error('Credential lock changed during recovery');
      fs.unlinkSync(lockPath); return;
    }
    throw new Error('Credential lock owner is still running or its PID was reused');
  } finally { releaseGuard(); }
}
