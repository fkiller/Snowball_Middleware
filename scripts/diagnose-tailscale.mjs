import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
export function diagnoseTailscale(executable, { runner = spawnSync, environment = process.env } = {}) {
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
    child = runner(binary, ['status', '--json', '--peers=false'], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000,
      maxBuffer: LIMIT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { return { status: 'unavailable' }; }
  if (!child || child.error || child.status !== 0 || typeof child.stdout !== 'string' || Buffer.byteLength(child.stdout) > LIMIT) return { status: 'unavailable' };
  try { return inspectTailscaleStatus(JSON.parse(child.stdout)); }
  catch { return { status: 'unrecognized' }; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--executable') {
    console.error('Usage: node scripts/diagnose-tailscale.mjs --executable /absolute/path/to/tailscale');
    process.exitCode = 2;
  } else {
    const result = diagnoseTailscale(args[1]);
    console.log(JSON.stringify(result));
    if (result.status !== 'observed') process.exitCode = 1;
  }
}
