import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class JournalFault extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'JournalFault'; }
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Single-writer local WAL. An incomplete tail fails closed; bytes are never silently discarded. */
export class DurableLog {
  private fd: number;
  private sequence = 0;
  private previous = '0'.repeat(64);
  private bytes = 0;
  private closed = false;
  private poisoned = false;
  readonly records: unknown[] = [];
  readonly token = randomUUID();
  readonly lockPath: string;
  readonly filePath: string;

  constructor(directory: string, private readonly maxBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new JournalFault('invalid', 'Invalid journal size limit');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    directory = fs.realpathSync(directory);
    this.lockPath = path.join(directory, 'commands.lock');
    this.filePath = path.join(directory, 'commands.v1.jsonl');
    let lock: number;
    try { lock = fs.openSync(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new JournalFault('locked', 'Journal already locked; offline recovery requires checking the old process has stopped');
      throw error;
    }
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: this.token })); fs.fsyncSync(lock);
    } finally { fs.closeSync(lock); }
    let fd: number | undefined;
    try {
      fd = fs.openSync(this.filePath, 'a+', 0o600);
      this.fd = fd;
      this.bytes = fs.fstatSync(fd).size;
      if (this.bytes > maxBytes) throw new JournalFault('capacity', 'Journal exceeds configured capacity');
      const text = fs.readFileSync(this.filePath, 'utf8');
      if (text && !text.endsWith('\n')) throw new JournalFault('corrupt', 'Incomplete journal tail; preserve file for offline repair');
      for (const line of text ? text.slice(0, -1).split('\n') : []) {
        let raw: unknown;
        try { raw = JSON.parse(line); } catch { throw new JournalFault('corrupt', 'Invalid journal JSON'); }
        if (!object(raw) || raw.version !== 1) throw new JournalFault('schema', 'Unsupported journal envelope version');
        if (raw.sequence !== this.sequence + 1 || raw.previous !== this.previous) throw new JournalFault('corrupt', 'Journal sequence/chain mismatch');
        const encoded = JSON.stringify({ version: 1, sequence: raw.sequence, previous: raw.previous, body: raw.body });
        if (raw.checksum !== digest(encoded)) throw new JournalFault('corrupt', 'Journal checksum mismatch');
        this.sequence++; this.previous = String(raw.checksum); this.records.push(raw.body);
      }
    } catch (error) {
      if (fd !== undefined) fs.closeSync(fd);
      fs.unlinkSync(this.lockPath);
      throw error;
    }
  }
  append(body: unknown): void {
    if (this.closed || this.poisoned) throw new JournalFault('unavailable', 'Journal closed or failed; no more dispatch is permitted');
    const entry = { version: 1, sequence: this.sequence + 1, previous: this.previous, body };
    const checksum = digest(JSON.stringify(entry));
    const encoded = Buffer.from(JSON.stringify({ ...entry, checksum }) + '\n');
    if (encoded.length > 1024 * 1024) throw new JournalFault('capacity', 'Journal transaction exceeds 1 MiB');
    if (this.bytes + encoded.length > this.maxBytes) throw new JournalFault('capacity', 'Journal capacity reached; offline maintenance required');
    try {
      for (let offset = 0; offset < encoded.length;) {
        const n = fs.writeSync(this.fd, encoded, offset, encoded.length - offset);
        if (n === 0) throw new Error('Short journal write');
        offset += n;
      }
      fs.fsyncSync(this.fd);
    } catch (error) { this.poisoned = true; throw new JournalFault('io', 'Journal write/flush failed; delivery state must be recovered before further dispatch'); }
    this.sequence++; this.previous = checksum; this.bytes += encoded.length;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    fs.closeSync(this.fd);
    const lock = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
    if (lock.token !== this.token) throw new JournalFault('locked', 'Lock ownership changed; refusing to remove it');
    fs.unlinkSync(this.lockPath);
  }
}

/** Exact-token, dead-PID recovery. Startup may call this only after private-state validation; never expose it through discovery or HTTP. */
export function recoverAbandonedJournalLock(directory: string, expectedToken: string): void {
  const lockPath = path.join(fs.realpathSync(directory), 'commands.lock');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as unknown;
  if (!object(lock) || lock.token !== expectedToken || !Number.isSafeInteger(lock.pid) || Number(lock.pid) <= 0) throw new JournalFault('locked', 'Lock metadata mismatch');
  try { process.kill(Number(lock.pid), 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new JournalFault('locked', 'Cannot prove old process is stopped');
    // Re-read before removal; this directory is private to one local OS user.
    if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).token !== expectedToken) throw new JournalFault('locked', 'Lock changed during offline recovery');
    fs.unlinkSync(lockPath); return;
  }
  throw new JournalFault('locked', 'Old process is still alive (or PID has been reused)');
}
