import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { renderQrSvg } from './qr-svg.js';

export interface PairedMobileDeviceInfo {
  deviceId: string;
  label: string;
  publicKeySpki: string;
  pairedAt: number;
  lastSeenAt: number;
}

export interface PendingPairingRequestInfo {
  pairingId: string;
  deviceId: string;
  deviceLabel: string;
  verificationCode: string;
  createdAt: number;
  expiresAt: number;
}

export interface ActiveInvitationInfo {
  invitationId: string;
  pairingCode: string;
  qrSvg: string;
  expiresAt: number;
  endpoints: string[];
  pcName: string;
}

interface StoredInvitation {
  invitationId: string;
  invitationSecret: string;
  fingerprint: string;
  tlsServerName: string;
  pcName: string;
  endpoints: string[];
  pairingCode: string;
  qrSvg: string;
  expiresAt: number;
}

interface PendingPairingRecord extends PendingPairingRequestInfo {
  publicKeySpki: string;
  fingerprint: string;
  pcName: string;
  status: 'pending' | 'approved' | 'rejected';
}

const DEVICES_FILE = 'paired-devices.v1.json';
const MAX_DEVICES = 16;
const INVITATION_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
const TIMESTAMP_SKEW_MS = 60 * 1000;

function validateP256Spki(publicKeySpki: string): { der: Buffer; keyObject: ReturnType<typeof createPublicKey>; deviceId: string } {
  if (typeof publicKeySpki !== 'string' || !/^[A-Za-z0-9_-]{80,200}$/.test(publicKeySpki)) {
    throw new Error('invalid_public_key');
  }
  const der = Buffer.from(publicKeySpki, 'base64url');
  if (der.length < 60 || der.length > 140) throw new Error('invalid_public_key');
  const keyObject = createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (keyObject.asymmetricKeyType !== 'ec' || keyObject.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('invalid_public_key');
  }
  const deviceId = `dev_${createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
  return { der, keyObject, deviceId };
}

function verifyP256Signature(canonicalMessage: string, signatureBase64Url: string, publicKeySpki: string): boolean {
  if (typeof signatureBase64Url !== 'string' || !/^[A-Za-z0-9_-]{64,160}$/.test(signatureBase64Url)) return false;
  try {
    const { keyObject } = validateP256Spki(publicKeySpki);
    const sigBytes = Buffer.from(signatureBase64Url, 'base64url');
    const data = Buffer.from(canonicalMessage, 'utf8');
    // Accept standard ASN.1 DER signatures as well as 64-byte IEEE-P1363 raw signatures.
    if (sigBytes.length === 64) {
      return verify('sha256', data, { key: keyObject, dsaEncoding: 'ieee-p1363' }, sigBytes);
    }
    return verify('sha256', data, { key: keyObject, dsaEncoding: 'der' }, sigBytes);
  } catch {
    return false;
  }
}

export function computeSasVerificationCode(invitationId: string, fingerprint: string, publicKeySpki: string): string {
  const digest = createHash('sha256')
    .update(`snowball-sas-v1\n${invitationId}\n${fingerprint.toLowerCase()}\n${publicKeySpki}`, 'utf8')
    .digest();
  const value = digest.readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, '0');
}

export interface RemotePairingCoordinatorOptions {
  directory?: string;
  verifyPrivateDirectory?: (dir: string, allowedFiles?: string[]) => string;
  now?: () => number;
  onChange?: () => void;
}

export class RemotePairingCoordinator {
  private readonly now: () => number;
  private readonly devices = new Map<string, PairedMobileDeviceInfo>();
  private readonly invitations = new Map<string, StoredInvitation>();
  private readonly pending = new Map<string, PendingPairingRecord>();
  private readonly nonces = new Map<string, number>();
  private activeInvitationId: string | null = null;

  constructor(private readonly options: RemotePairingCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.loadDevices();
  }

  private devicesFilePath(): string | null {
    if (!this.options.directory) return null;
    return path.join(this.options.directory, DEVICES_FILE);
  }

  private loadDevices(): void {
    const filePath = this.devicesFilePath();
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version?: number; devices?: PairedMobileDeviceInfo[] };
      if (raw?.version !== 1 || !Array.isArray(raw.devices)) return;
      for (const item of raw.devices.slice(0, MAX_DEVICES)) {
        if (!item || typeof item.deviceId !== 'string' || typeof item.label !== 'string' || typeof item.publicKeySpki !== 'string') continue;
        const { deviceId } = validateP256Spki(item.publicKeySpki);
        if (deviceId !== item.deviceId) continue;
        this.devices.set(deviceId, {
          deviceId,
          label: item.label.slice(0, 64),
          publicKeySpki: item.publicKeySpki,
          pairedAt: Number.isFinite(item.pairedAt) ? item.pairedAt : this.now(),
          lastSeenAt: Number.isFinite(item.lastSeenAt) ? item.lastSeenAt : this.now(),
        });
      }
    } catch {
      // Ignore corrupt or unreadable device list and start clean in memory.
    }
  }

  private saveDevices(): void {
    const filePath = this.devicesFilePath();
    if (!filePath || !this.options.directory) return;
    fs.mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({
      version: 1,
      devices: [...this.devices.values()],
    }, null, 2) + '\n';
    const tmp = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, payload, { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  private prune(): void {
    const now = this.now();
    for (const [id, inv] of this.invitations) {
      if (inv.expiresAt <= now) {
        this.invitations.delete(id);
        if (this.activeInvitationId === id) this.activeInvitationId = null;
      }
    }
    for (const [id, req] of this.pending) {
      if (req.expiresAt <= now) this.pending.delete(id);
    }
    for (const [key, exp] of this.nonces) {
      if (exp <= now) this.nonces.delete(key);
    }
  }

  createInvitation(params: {
    pcName: string;
    tlsServerName: string;
    fingerprint: string;
    endpoints: string[];
  }): ActiveInvitationInfo {
    this.prune();
    const now = this.now();
    const fingerprint = params.fingerprint.toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('invalid_fingerprint');
    const endpoints = params.endpoints.filter(u => typeof u === 'string' && u.startsWith('https://')).slice(0, 6);
    if (!endpoints.length) throw new Error('no_endpoints');
    const pcName = (params.pcName || 'Snowball PC').trim().slice(0, 48) || 'Snowball PC';
    const invitationId = `inv_${randomBytes(8).toString('hex')}`;
    const invitationSecret = randomBytes(24).toString('base64url');
    const expiresAt = now + INVITATION_TTL_MS;

    const compactPayload = {
      v: 1,
      n: pcName,
      s: params.tlsServerName.toLowerCase(),
      f: Buffer.from(fingerprint, 'hex').toString('base64url'),
      u: endpoints,
      i: invitationId,
      k: invitationSecret,
    };
    const pairingCode = `SBP1.${Buffer.from(JSON.stringify(compactPayload), 'utf8').toString('base64url')}`;
    const qrSvg = renderQrSvg(pairingCode);

    // Replace previous unconsumed invitations so only the current QR code is active.
    this.invitations.clear();
    this.invitations.set(invitationId, {
      invitationId,
      invitationSecret,
      fingerprint,
      tlsServerName: params.tlsServerName.toLowerCase(),
      pcName,
      endpoints,
      pairingCode,
      qrSvg,
      expiresAt,
    });
    this.activeInvitationId = invitationId;
    this.options.onChange?.();
    return { invitationId, pairingCode, qrSvg, expiresAt, endpoints, pcName };
  }

  getActiveInvitation(): ActiveInvitationInfo | null {
    this.prune();
    if (!this.activeInvitationId) return null;
    const inv = this.invitations.get(this.activeInvitationId);
    if (!inv) return null;
    return {
      invitationId: inv.invitationId,
      pairingCode: inv.pairingCode,
      qrSvg: inv.qrSvg,
      expiresAt: inv.expiresAt,
      endpoints: [...inv.endpoints],
      pcName: inv.pcName,
    };
  }

  submitPairRequest(body: Record<string, unknown>, gatewayFingerprint: string): {
    pairingId: string;
    deviceId: string;
    verificationCode: string;
    expiresAt: number;
    pcName: string;
  } {
    this.prune();
    const now = this.now();
    const invitationId = typeof body.invitationId === 'string' ? body.invitationId : '';
    const deviceLabelRaw = typeof body.deviceLabel === 'string' ? body.deviceLabel.trim() : '';
    const deviceLabel = (deviceLabelRaw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64)) || 'iPhone';
    const publicKeySpki = typeof body.publicKeySpki === 'string' ? body.publicKeySpki : '';
    const timestamp = typeof body.timestamp === 'number' ? body.timestamp : Number(body.timestamp);
    const proof = typeof body.proof === 'string' ? body.proof : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';

    if (!invitationId || !publicKeySpki || !Number.isFinite(timestamp) || !proof || !signature) {
      throw new Error('invalid_pair_request');
    }
    if (Math.abs(now - timestamp) > TIMESTAMP_SKEW_MS * 2) {
      throw new Error('pair_request_expired');
    }
    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.expiresAt <= now) {
      throw new Error('invitation_invalid_or_expired');
    }
    const fp = gatewayFingerprint.toLowerCase();
    if (invitation.fingerprint !== fp) {
      throw new Error('gateway_identity_mismatch');
    }

    const { deviceId } = validateP256Spki(publicKeySpki);

    // Verify single-use invitation HMAC proof
    const expectedProof = createHmac('sha256', invitation.invitationSecret)
      .update(`snowball-pair-v1\n${invitationId}\n${fp}\n${publicKeySpki}\n${timestamp}`, 'utf8')
      .digest('base64url');
    const proofBuf = Buffer.from(proof, 'utf8');
    const expectedBuf = Buffer.from(expectedProof, 'utf8');
    if (proofBuf.length !== expectedBuf.length || !timingSafeEqual(proofBuf, expectedBuf)) {
      throw new Error('invitation_proof_invalid');
    }

    // Verify P-256 key possession signature
    const sigMessage = `snowball-pair-sig-v1\n${invitationId}\n${fp}\n${publicKeySpki}\n${timestamp}\n${proof}`;
    if (!verifyP256Signature(sigMessage, signature, publicKeySpki)) {
      throw new Error('device_signature_invalid');
    }

    // Consume the single-use invitation immediately
    this.invitations.delete(invitationId);
    if (this.activeInvitationId === invitationId) this.activeInvitationId = null;

    // Remove any older pending requests for the same deviceId
    for (const [id, existing] of this.pending) {
      if (existing.deviceId === deviceId) this.pending.delete(id);
    }
    if (this.pending.size >= 8) {
      const oldestKey = this.pending.keys().next().value;
      if (oldestKey) this.pending.delete(oldestKey);
    }

    const pairingId = `pair_${randomBytes(8).toString('hex')}`;
    const verificationCode = computeSasVerificationCode(invitationId, fp, publicKeySpki);
    const expiresAt = now + PENDING_TTL_MS;

    this.pending.set(pairingId, {
      pairingId,
      deviceId,
      deviceLabel,
      publicKeySpki,
      fingerprint: fp,
      pcName: invitation.pcName,
      verificationCode,
      createdAt: now,
      expiresAt,
      status: 'pending',
    });

    this.options.onChange?.();
    return {
      pairingId,
      deviceId,
      verificationCode,
      expiresAt,
      pcName: invitation.pcName,
    };
  }

  checkPairStatus(params: {
    deviceId: string;
    timestamp: string;
    nonce: string;
    signature: string;
    gatewayFingerprint: string;
  }): { status: 'pending' | 'approved' | 'rejected'; verificationCode?: string; expiresAt?: number; pcName?: string; deviceId?: string } {
    this.prune();
    const now = this.now();
    const ts = Number(params.timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_SKEW_MS) {
      throw new Error('unauthorized');
    }
    if (typeof params.nonce !== 'string' || !/^[A-Za-z0-9_-]{12,64}$/.test(params.nonce)) {
      throw new Error('unauthorized');
    }
    const fp = params.gatewayFingerprint.toLowerCase();
    const canonical = `snowball-req-v1\nGET\n/remote/v1/pair/status\n${fp}\n${params.timestamp}\n${params.nonce}`;

    // Check pending records first (most recent for this deviceId)
    let matchedPending: PendingPairingRecord | undefined;
    for (const record of this.pending.values()) {
      if (record.deviceId === params.deviceId) matchedPending = record;
    }
    if (matchedPending) {
      if (!verifyP256Signature(canonical, params.signature, matchedPending.publicKeySpki)) {
        throw new Error('unauthorized');
      }
      if (matchedPending.status === 'approved') {
        return { status: 'approved', deviceId: matchedPending.deviceId, pcName: matchedPending.pcName };
      }
      if (matchedPending.status === 'rejected') {
        return { status: 'rejected' };
      }
      return {
        status: 'pending',
        verificationCode: matchedPending.verificationCode,
        expiresAt: matchedPending.expiresAt,
        pcName: matchedPending.pcName,
        deviceId: matchedPending.deviceId,
      };
    }

    // Also check if already approved in devices map
    const approved = this.devices.get(params.deviceId);
    if (approved) {
      if (!verifyP256Signature(canonical, params.signature, approved.publicKeySpki)) {
        throw new Error('unauthorized');
      }
      return { status: 'approved', deviceId: approved.deviceId };
    }

    throw new Error('unauthorized');
  }

  approvePairing(pairingId: string): PairedMobileDeviceInfo {
    this.prune();
    const record = this.pending.get(pairingId);
    if (!record || record.status !== 'pending') {
      throw new Error('pairing_not_found');
    }
    if (this.devices.size >= MAX_DEVICES && !this.devices.has(record.deviceId)) {
      throw new Error('device_capacity_reached');
    }
    const now = this.now();
    record.status = 'approved';
    const device: PairedMobileDeviceInfo = {
      deviceId: record.deviceId,
      label: record.deviceLabel,
      publicKeySpki: record.publicKeySpki,
      pairedAt: now,
      lastSeenAt: now,
    };
    this.devices.set(device.deviceId, device);
    this.saveDevices();
    this.options.onChange?.();
    return { ...device };
  }

  rejectPairing(pairingId: string): void {
    this.prune();
    const record = this.pending.get(pairingId);
    if (!record) return;
    record.status = 'rejected';
    this.options.onChange?.();
  }

  authenticateSignedRequest(params: {
    method: string;
    path: string;
    deviceId: string;
    timestamp: string;
    nonce: string;
    signature: string;
    gatewayFingerprint: string;
  }): PairedMobileDeviceInfo | null {
    this.prune();
    const device = this.devices.get(params.deviceId);
    if (!device) return null;
    const now = this.now();
    const ts = Number(params.timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_SKEW_MS) return null;
    if (typeof params.nonce !== 'string' || !/^[A-Za-z0-9_-]{12,64}$/.test(params.nonce)) return null;
    const nonceKey = `${device.deviceId}:${params.nonce}`;
    if (this.nonces.has(nonceKey)) return null;
    const fp = params.gatewayFingerprint.toLowerCase();
    const canonical = `snowball-req-v1\n${params.method}\n${params.path}\n${fp}\n${params.timestamp}\n${params.nonce}`;
    if (!verifyP256Signature(canonical, params.signature, device.publicKeySpki)) return null;
    if (this.nonces.size >= 4096) {
      const oldest = this.nonces.keys().next().value;
      if (oldest) this.nonces.delete(oldest);
    }
    this.nonces.set(nonceKey, now + TIMESTAMP_SKEW_MS * 2);
    device.lastSeenAt = now;
    return { ...device };
  }

  listPendingRequests(): PendingPairingRequestInfo[] {
    this.prune();
    return [...this.pending.values()]
      .filter(r => r.status === 'pending')
      .map(r => ({
        pairingId: r.pairingId,
        deviceId: r.deviceId,
        deviceLabel: r.deviceLabel,
        verificationCode: r.verificationCode,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  }

  listPairedDevices(): PairedMobileDeviceInfo[] {
    return [...this.devices.values()].map(d => ({ ...d }));
  }

  revokeDevice(deviceId: string): boolean {
    const deleted = this.devices.delete(deviceId);
    for (const [id, req] of this.pending) {
      if (req.deviceId === deviceId) this.pending.delete(id);
    }
    if (deleted) {
      this.saveDevices();
      this.options.onChange?.();
    }
    return deleted;
  }
}
