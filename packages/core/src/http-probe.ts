import http from 'node:http';
import https from 'node:https';
import { assessProbe, type ProbeAssessment, type ProbeObservation } from './probes.js';

export interface HttpProbePolicy {
  /** Reviewed provider route, never taken from a discovered server response. */
  healthPath: string;
  identity: Record<string, string | boolean>;
  versionField: string;
  supportedVersions: string[];
  schema?: { path: string; identity: Record<string, string | boolean> };
}
export type HttpProbeFailure = 'invalid_endpoint' | 'busy' | 'cancelled' | 'timeout' | 'not_running' | 'permission_denied' | 'transport_failed' | 'redirect' | 'response_limit' | 'invalid_response' | 'wrong_service' | 'unsupported_version' | 'http_error' | null;
export interface HttpProbeResult {
  generation: number; observedAt: number; assessment: ProbeAssessment;
  version: string | null; failure: HttpProbeFailure;
}
class ProbeFault extends Error { constructor(readonly code: Exclude<HttpProbeFailure, null>, readonly reachable = false) { super(code); } }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const route = (v: unknown): v is string => typeof v === 'string' && /^\/[A-Za-z0-9_/-]*$/.test(v) && v.length <= 256 && !v.includes('//');
const identity = (v: unknown): v is Record<string, string | boolean> => object(v) && Object.keys(v).length > 0 && Object.keys(v).length <= 16 && Object.entries(v).every(([k, value]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k) && (typeof value === 'boolean' || typeof value === 'string' && value.length <= 128));
const matches = (value: unknown, expected: Record<string, string | boolean>): boolean => object(value) && Object.entries(expected).every(([key, v]) => Object.hasOwn(value, key) && value[key] === v);
const unknownFacts = (): ProbeObservation => ({ presence: 'unknown', compatibility: 'unknown', auth: 'unknown', permission: 'unknown', connectivity: 'unknown', advertisedControl: false });
let activeRequests = 0;

function endpointOrigin(value: string): URL {
  // Reject alternate numeric IP spellings before the URL parser normalizes them.
  if (typeof value !== 'string' || value.length > 256 || !/^https?:\/\/(127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?\/?$/.test(value)) throw new ProbeFault('invalid_endpoint');
  try { return new URL(value); } catch { throw new ProbeFault('invalid_endpoint'); }
}

function getJson(origin: URL, pathname: string, signal: AbortSignal): Promise<{ status: number; value: unknown }> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: ProbeFault, result?: { status: number; value: unknown }) => {
      if (finished) return; finished = true; signal.removeEventListener('abort', cancel);
      request.destroy(); if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new ProbeFault(signal.reason === 'deadline' ? 'timeout' : 'cancelled'));
    const request = (origin.protocol === 'https:' ? https : http).request({
      protocol: origin.protocol, hostname: origin.hostname.replace(/^\[|\]$/g, ''), port: origin.port || undefined,
      path: pathname, method: 'GET', agent: false, maxHeaderSize: 8192,
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Connection: 'close' },
      // Node's direct HTTP client does not consult proxy environment variables.
    }, response => {
      const status = response.statusCode ?? 0;
      response.on('error', () => finish(new ProbeFault('transport_failed', true)));
      if (status >= 300 && status < 400) return finish(new ProbeFault('redirect', true));
      if (status === 401 || status === 403) return finish(undefined, { status, value: null });
      if (status !== 200) return finish(new ProbeFault('http_error', true));
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') return finish(new ProbeFault('invalid_response', true));
      if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers['content-type'] ?? '')) return finish(new ProbeFault('invalid_response', true));
      const length = response.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length) > 65536)) return finish(new ProbeFault('response_limit', true));
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) return finish(new ProbeFault('response_limit', true));
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (finished) return;
        try {
          const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          if (!object(value)) throw new Error();
          finish(undefined, { status, value });
        } catch { finish(new ProbeFault('invalid_response', true)); }
      });
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      const code = error.code === 'ECONNREFUSED' ? 'not_running' : ['EACCES', 'EPERM'].includes(error.code ?? '') ? 'permission_denied' : error.code === 'HPE_HEADER_OVERFLOW' ? 'response_limit' : 'transport_failed';
      finish(new ProbeFault(code));
    });
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel(); else request.end();
  });
}

/** One selected candidate per instance. Refresh cancels old work; no auto retry or credentials. */
export class HttpHarnessProbe {
  readonly #policy: HttpProbePolicy;
  #generation = 0;
  #abort?: AbortController;
  #result?: HttpProbeResult;
  constructor(policy: HttpProbePolicy) {
    if (!policy || !route(policy.healthPath) || !identity(policy.identity) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(policy.versionField) || !Array.isArray(policy.supportedVersions) || policy.supportedVersions.length < 1 || policy.supportedVersions.length > 128 || policy.supportedVersions.some(v => typeof v !== 'string' || !/^[0-9][A-Za-z0-9.+-]{0,63}$/.test(v)) || policy.schema && (!route(policy.schema.path) || !identity(policy.schema.identity))) throw new Error('invalid_probe_policy');
    this.#policy = structuredClone(policy);
  }
  snapshot(): HttpProbeResult | undefined { return this.#result && structuredClone(this.#result); }
  cancel(): void { this.#abort?.abort(); }
  async probe(endpoint: string, options: { signal?: AbortSignal; timeoutMs?: number; installed?: boolean } = {}): Promise<HttpProbeResult> {
    const timeout = options.timeoutMs ?? 3000;
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 5000) throw new Error('invalid_probe_timeout');
    this.#abort?.abort(); const abort = new AbortController(); this.#abort = abort;
    const generation = ++this.#generation;
    const facts = unknownFacts(); if (options.installed) facts.presence = 'installed';
    let version: string | null = null; let failure: HttpProbeFailure = null; let acquired = false;
    const cancel = () => abort.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timer = setTimeout(() => abort.abort('deadline'), timeout);
    try {
      const origin = endpointOrigin(endpoint);
      if (abort.signal.aborted) throw new ProbeFault('cancelled');
      if (activeRequests >= 4) throw new ProbeFault('busy');
      activeRequests++; acquired = true;
      const health = await getJson(origin, this.#policy.healthPath, abort.signal);
      facts.connectivity = 'reachable';
      if (health.status === 401) facts.auth = 'required';
      else if (health.status === 403) facts.permission = 'denied';
      else {
        if (!matches(health.value, this.#policy.identity)) throw new ProbeFault('wrong_service', true);
        const v = (health.value as Record<string, unknown>)[this.#policy.versionField];
        if (typeof v !== 'string' || !this.#policy.supportedVersions.includes(v)) throw new ProbeFault('unsupported_version', true);
        version = v;
        if (this.#policy.schema) {
          const schema = await getJson(origin, this.#policy.schema.path, abort.signal);
          if (schema.status === 401) facts.auth = 'required';
          else if (schema.status === 403) facts.permission = 'denied';
          else if (!matches(schema.value, this.#policy.schema.identity)) throw new ProbeFault('wrong_service', true);
        }
        if (facts.auth !== 'required' && facts.permission !== 'denied') {
          facts.presence = 'running'; facts.compatibility = 'supported'; facts.auth = 'not_required'; facts.permission = 'granted';
        }
      }
      if (abort.signal.aborted) throw new ProbeFault(abort.signal.reason === 'deadline' ? 'timeout' : 'cancelled');
    } catch (error) {
      const fault = error instanceof ProbeFault ? error : new ProbeFault('transport_failed');
      failure = fault.code;
      if (fault.reachable) facts.connectivity = 'reachable';
      if (failure === 'not_running') { facts.presence = options.installed ? 'installed' : 'unknown'; facts.connectivity = 'offline'; }
      if (failure === 'permission_denied') facts.permission = 'denied';
      if (failure === 'wrong_service') facts.compatibility = 'wrong_service';
      if (failure === 'unsupported_version') facts.compatibility = 'unsupported';
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (acquired) activeRequests--; if (generation === this.#generation) this.#abort = undefined;
    }
    const result = { generation, observedAt: Date.now(), assessment: assessProbe(facts), version, failure };
    if (generation === this.#generation) this.#result = result;
    return structuredClone(result);
  }
}
