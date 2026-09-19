import fs from 'node:fs';
import path from 'node:path';

export class InstanceLockFault extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstanceLockFault';
    this.code = code;
  }
}

/**
 * Manages single-instance lifecycle and crash recovery for the desktop daemon.
 * Uses a PID lockfile inside the private state directory.
 */
export class DesktopLifecycle {
  lockFile = null;
  lockFd = null;

  constructor(dataDir) {
    this.dataDir = dataDir;
    this.lockFile = path.join(dataDir, 'snowball.lock');
  }

  /**
   * Acquires the single-instance lock.
   * If an existing lock exists:
   * - Checks if the PID is still alive.
   * - If alive, rejects with `already_running`.
   * - If dead (stale crash), recovers lock safely.
   */
  acquireLock() {
    try {
      this.lockFd = fs.openSync(this.lockFile, 'wx', 0o600);
      fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + '\n');
      fs.fsyncSync(this.lockFd);
      return { acquired: true, recovered: false };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Check existing lock for stale PID
      let lockData;
      try {
        lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
      } catch {
        // Corrupted lock file -> recover
        return this.forceRecoverLock();
      }

      if (typeof lockData.pid === 'number') {
        const isAlive = this.isProcessAlive(lockData.pid);
        if (isAlive) {
          throw new InstanceLockFault(
            'already_running',
            `Another Snowball Middleware instance is already running (PID ${lockData.pid})`
          );
        }
      }
      // Process is dead -> recover stale lock
      return this.forceRecoverLock();
    }
  }

  forceRecoverLock() {
    try {
      fs.unlinkSync(this.lockFile);
    } catch {}
    this.lockFd = fs.openSync(this.lockFile, 'wx', 0o600);
    fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid, createdAt: Date.now(), recovered: true }) + '\n');
    fs.fsyncSync(this.lockFd);
    return { acquired: true, recovered: true };
  }

  isProcessAlive(pid) {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM'; // EPERM means process exists but owned by different user
    }
  }

  releaseLock() {
    if (this.lockFd !== null) {
      try {
        fs.closeSync(this.lockFd);
      } catch {}
      this.lockFd = null;
    }
    try {
      if (fs.existsSync(this.lockFile)) {
        const data = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        if (data.pid === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      }
    } catch {}
  }
}
