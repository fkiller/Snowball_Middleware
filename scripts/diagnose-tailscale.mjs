import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectServeStatus } from '../apps/desktop/tailscale-serve-status.mjs';

// Development diagnostic only. It does not configure Serve/Funnel, establish
// a connection, or prove that the local node belongs to the user. Tailscale's
// JSON format can change: unrecognized states and malformed fields stay unknown.
const BACKEND_STATES = new Set(['NoState', 'InUseOtherUser', 'NeedsLogin', 'NeedsMachineAuth', 'Stopped', 'Starting', 'Running']);
const LIMIT = 256 * 1024;

export function inspectTailscaleStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unrecognized' };
  if (typeof value.BackendState !== 'string' || !BACKEND_STATES.has(value.BackendState)) return { status: 'unrecognized' };
  const self = value.Self && typeof value.Self === 'object' && !Array.isArray(value.Self) ? value.Self : undefined;
  const online = typeof self?.Online === 'boolean' ? self.Online : null;
  const dns = typeof self?.DNSName === 'string' && self.DNSName.length <= 254 && /^(?=.{1,253}\.?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i.test(self.DNSName);
  return { status: 'observed', backendState: value.BackendState, selfOnline: online, dnsNameReported: Boolean(dns), connection: 'not_tested', serve: 'not_checked', identity: 'not_verified' };
}

// The caller explicitly selects the executable; no PATH search or shell input.
// The selected local program is trusted to be the user's Tailscale CLI.
function readTailscale(executable, args, { runner = spawnSync, environment = process.env } = {}) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) return { status: 'invalid_executable' };
  let binary;
  try {
    binary = fs.realpathSync(executable);
    if (!fs.statSync(binary).isFile()) return { status: 'invalid_executable' };
    fs.accessSync(binary, fs.constants.X_OK);
  } catch { return { status: 'invalid_executable' }; }
  const env = {};
  // Do not pass arbitrary runtime/injection variables or output their values.
  for (const name of ['HOME', 'USERPROFILE', 'XDG_RUNTIME_DIR', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (typeof environment[name] === 'string') env[name] = environment[name];
  }
  env.TAILSCALE_BE_CLI = '1';
  let child;
  try {
    child = runner(binary, args, {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000,
      maxBuffer: LIMIT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { return { status: 'unavailable' }; }
  if (!child || child.error || child.status !== 0 || typeof child.stdout !== 'string' || Buffer.byteLength(child.stdout) > LIMIT) return { status: 'unavailable' };
  try { return { status: 'observed', value: JSON.parse(child.stdout) }; }
  catch { return { status: 'unrecognized' }; }
}

export function diagnoseTailscale(executable, options = {}) {
  const result = readTailscale(executable, ['status', '--json', '--peers=false'], options);
  return result.status === 'observed' ? inspectTailscaleStatus(result.value) : result;
}

// Reads a single snapshot, never configures Serve or Funnel, and deliberately
// returns no names, addresses, destination URLs, or raw CLI output. Even an
// exact match proves neither gateway identity nor a safe live connection.
export function diagnoseTailscaleServe(executable, ports, options = {}) {
  if (!Number.isInteger(ports?.listenPort) || ports.listenPort < 1 || ports.listenPort > 65535 ||
      !Number.isInteger(ports?.backendPort) || ports.backendPort < 1 || ports.backendPort > 65535) return { status: 'invalid_ports' };
  const result = readTailscale(executable, ['serve', 'status', '--json'], options);
  if (result.status !== 'observed') return result;
  return { status: 'observed', ...inspectServeStatus(result.value, ports) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const status = args.length === 2 && args[0] === '--executable';
  const serve = args.length === 6 && args[0] === '--executable' && args[2] === '--serve-port' && args[4] === '--backend-port' &&
    /^[1-9][0-9]{0,4}$/.test(args[3]) && /^[1-9][0-9]{0,4}$/.test(args[5]);
  if (!status && !serve) {
    console.error('Usage: node scripts/diagnose-tailscale.mjs --executable /absolute/path/to/tailscale [--serve-port PORT --backend-port PORT]');
    process.exitCode = 2;
  } else {
    const result = serve ? diagnoseTailscaleServe(args[1], { listenPort: Number(args[3]), backendPort: Number(args[5]) }) : diagnoseTailscale(args[1]);
    console.log(JSON.stringify(result));
    if (result.status !== 'observed') process.exitCode = 1;
  }
}
