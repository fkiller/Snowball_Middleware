import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class UpdateFault extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'UpdateFault';
  }
}

/**
 * Artifact and update verification with rollback support (MW.08.02.01.01).
 *
 * Invariants:
 * - Immutable artifact SHA-256 verification before installation/execution (R-RECOVER).
 * - Tampered, corrupted, or hash-mismatched updates are rejected immediately.
 * - Previous good version is retained and restored on failure (rollback).
 */
export class DesktopUpdater {
  constructor(installDir, backupDir = path.join(installDir, '..', 'backup')) {
    this.installDir = installDir;
    this.backupDir = backupDir;
  }

  /**
   * Verifies an update artifact's SHA-256 hash against the reviewed manifest.
   */
  verifyArtifact(artifactBuffer, expectedSha256) {
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      throw new UpdateFault('invalid_digest', 'Invalid expected SHA-256 hash');
    }
    const actual = createHash('sha256').update(artifactBuffer).digest('hex');
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new UpdateFault(
        'integrity_mismatch',
        `Artifact hash mismatch: expected ${expectedSha256}, got ${actual}`
      );
    }
    return true;
  }

  /**
   * Applies an update with automatic backup and rollback.
   */
  async applyUpdate({ artifactBuffer, expectedSha256, version }) {
    // 1. Verify integrity before touching filesystem
    this.verifyArtifact(artifactBuffer, expectedSha256);

    // 2. Create backup of current installed version
    if (fs.existsSync(this.installDir)) {
      if (fs.existsSync(this.backupDir)) {
        fs.rmSync(this.backupDir, { recursive: true, force: true });
      }
      fs.cpSync(this.installDir, this.backupDir, { recursive: true });
    }

    try {
      // 3. Write new artifact
      fs.mkdirSync(this.installDir, { recursive: true });
      const targetFile = path.join(this.installDir, 'app.bundle');
      fs.writeFileSync(targetFile, artifactBuffer);

      const metaFile = path.join(this.installDir, 'version.json');
      fs.writeFileSync(metaFile, JSON.stringify({ version, sha256: expectedSha256, updatedAt: new Date().toISOString() }) + '\n');

      return { success: true, version };
    } catch (err) {
      // 4. Automatic rollback on any failure
      await this.rollback();
      throw new UpdateFault('apply_failed', `Failed to apply update: ${err.message}`);
    }
  }

  /**
   * Restores the previous installed version from backup.
   */
  async rollback() {
    if (!fs.existsSync(this.backupDir)) {
      throw new UpdateFault('no_backup', 'No backup available for rollback');
    }

    if (fs.existsSync(this.installDir)) {
      fs.rmSync(this.installDir, { recursive: true, force: true });
    }
    fs.cpSync(this.backupDir, this.installDir, { recursive: true });
    return { restored: true };
  }
}

/**
 * Uninstall manager with selective user data / secret preservation or complete purge (MW.08.02.01.01.A2).
 */
export class DesktopUninstaller {
  constructor(installDir, userDataDir, modelsDir) {
    this.installDir = installDir;
    this.userDataDir = userDataDir;
    this.modelsDir = modelsDir || (userDataDir ? path.join(userDataDir, 'models') : undefined);
  }

  /**
   * Performs uninstallation.
   * @param {'keep_data' | 'remove_all'} mode
   */
  async uninstall(mode = 'keep_data') {
    const result = {
      binariesRemoved: false,
      userDataPurged: false,
      modelsPurged: false,
      mode,
    };

    // 1. Remove application binaries
    if (fs.existsSync(this.installDir)) {
      fs.rmSync(this.installDir, { recursive: true, force: true });
      result.binariesRemoved = true;
    }

    // 2. Handle user data, downloaded models & secrets according to mode
    if (mode === 'remove_all') {
      // Purge downloaded models if stored in explicit location
      if (this.modelsDir && fs.existsSync(this.modelsDir)) {
        fs.rmSync(this.modelsDir, { recursive: true, force: true });
        result.modelsPurged = true;
      }

      if (fs.existsSync(this.userDataDir)) {
        // Securely wipe known sensitive files first before directory removal
        const sensitiveFiles = [
          path.join(this.userDataDir, 'host.v1.json'),
          path.join(this.userDataDir, 'settings.json'),
        ];
        for (const f of sensitiveFiles) {
          if (fs.existsSync(f)) {
            try {
              const size = fs.statSync(f).size;
              fs.writeFileSync(f, Buffer.alloc(size, 0)); // zero out
            } catch {}
          }
        }

        fs.rmSync(this.userDataDir, { recursive: true, force: true });
        result.userDataPurged = true;
        result.modelsPurged = true;
      }
    } else {
      // keep_data: user data directory and downloaded models are left intact
      result.userDataPurged = false;
      result.modelsPurged = false;
    }

    return result;
  }
}
