import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { extractTailscaleSelfHost } from '../../packages/api/dist/index.js';

// Candidates are suggestions, not trusted identities. The native dialog must
// display the executable and obtain explicit consent before it is run.
export function tailscaleCandidates({ platform = process.platform, env = process.env } = {}) {
  const names = platform === 'win32' ? ['tailscale.exe'] : ['tailscale'];
  const places = platform === 'win32'
    ? [env.ProgramFiles && path.join(env.ProgramFiles, 'Tailscale', 'tailscale.exe')]
    : platform === 'darwin'
      ? ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale']
      : ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/snap/bin/tailscale'];
  for (const entry of (env.PATH || '').split(path.delimiter)) {
    if (entry && path.isAbsolute(entry)) for (const name of names) places.push(path.join(entry, name));
  }
  const result = [];
  for (const candidate of places) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try {
      const real = fs.realpathSync(candidate);
      if (!fs.statSync(real).isFile()) continue;
      fs.accessSync(real, fs.constants.X_OK);
      if (!result.includes(real)) result.push(real);
    } catch { /* Not an installed executable. */ }
  }
  return result;
}

// Caller chooses and explicitly approves the local program. Never invoke a
// shell, log raw output, configure Serve, or infer remote connectivity here.
export async function inspectApprovedTailscale(executable, { run = execFile, env = process.env } = {}) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) return { kind: 'invalid_executable' };
  let binary;
  try {
    binary = fs.realpathSync(executable);
    if (!fs.statSync(binary).isFile()) return { kind: 'invalid_executable' };
    fs.accessSync(binary, fs.constants.X_OK);
  } catch { return { kind: 'invalid_executable' }; }
  const safeEnv = {};
  for (const name of ['HOME', 'USERPROFILE', 'XDG_RUNTIME_DIR', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (typeof env[name] === 'string') safeEnv[name] = env[name];
  }
  // The macOS application bundles its CLI in the GUI executable. Tailscale
  // documents this fixed flag for non-interactive CLI invocation.
  safeEnv.TAILSCALE_BE_CLI = '1';
  let raw;
  try {
    raw = await new Promise((resolve, reject) => run(binary, ['status', '--json', '--peers=false'], {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, env: safeEnv,
    }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  } catch { return { kind: 'unavailable' }; }
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256 * 1024) return { kind: 'unrecognized' };
  let status;
  try { status = JSON.parse(raw); } catch { return { kind: 'unrecognized' }; }
  if (!status || typeof status !== 'object' || Array.isArray(status)) return { kind: 'unrecognized' };
  if (status.BackendState === 'NeedsLogin') return { kind: 'needs_login' };
  if (status.BackendState === 'NeedsMachineAuth') return { kind: 'needs_approval' };
  if (status.BackendState !== 'Running') return { kind: 'not_running' };
  if (status.Self?.Online !== true) return { kind: 'offline' };
  try { return { kind: 'ready', host: extractTailscaleSelfHost(status) }; }
  catch { return { kind: 'no_hostname' }; }
}

export function describeTailscaleInspection(result, language = 'ko') {
  const english = language === 'en';
  const messages = english ? {
    invalid_executable: ['Could not open the selected program.', 'Choose the Tailscale command-line executable installed on this PC.'],
    unavailable: ['Could not read Tailscale status.', 'Open the Tailscale app on this PC, check that it is running, and try again.'],
    unrecognized: ['Tailscale returned an unrecognized status.', 'Update Tailscale and try again. No remote connection was enabled.'],
    needs_login: ['Sign in to Tailscale on this PC.', 'Open the Tailscale app, sign in, and then run this check again.'],
    needs_approval: ['This PC needs approval in Tailscale.', 'Ask the tailnet administrator to approve this PC, then run this check again.'],
    not_running: ['Tailscale is not running on this PC.', 'Open Tailscale and connect it, then run this check again.'],
    offline: ['This PC is not online in Tailscale.', 'Check the PC network and Tailscale connection, then run this check again.'],
    no_hostname: ['No usable Tailscale address was found.', 'Check Tailscale DNS and this PC’s approval in the Tailscale admin console, then try again.'],
  } : {
    invalid_executable: ['선택한 프로그램을 열 수 없습니다.', '이 PC에 설치된 Tailscale 명령줄 실행 파일을 선택하세요.'],
    unavailable: ['Tailscale 상태를 읽지 못했습니다.', '이 PC에서 Tailscale 앱이 실행 중인지 확인하고 다시 시도하세요.'],
    unrecognized: ['Tailscale 상태를 해석하지 못했습니다.', 'Tailscale을 업데이트하고 다시 시도하세요. 원격 연결은 활성화되지 않았습니다.'],
    needs_login: ['이 PC에서 Tailscale에 로그인하세요.', 'Tailscale 앱을 열어 로그인한 뒤 다시 확인하세요.'],
    needs_approval: ['Tailscale에서 이 PC의 승인이 필요합니다.', 'tailnet 관리자에게 이 PC의 승인을 요청한 뒤 다시 확인하세요.'],
    not_running: ['이 PC에서 Tailscale이 실행 중이 아닙니다.', 'Tailscale을 열고 연결한 뒤 다시 확인하세요.'],
    offline: ['이 PC가 Tailscale에 연결되어 있지 않습니다.', 'PC 네트워크와 Tailscale 연결을 확인한 뒤 다시 확인하세요.'],
    no_hostname: ['사용 가능한 Tailscale 주소를 찾지 못했습니다.', 'Tailscale 관리자 화면에서 DNS와 이 PC의 승인 상태를 확인한 뒤 다시 시도하세요.'],
  };
  if (result?.kind === 'ready' && typeof result.host === 'string') return english
    ? { message: 'Tailscale reports an address for this PC.', detail: `https://${result.host}\n\nThis checks only local Tailscale status. Secure Snowball connection and phone pairing are not yet enabled.` }
    : { message: '이 PC의 Tailscale 주소를 확인했습니다.', detail: `https://${result.host}\n\n이 검사는 PC의 Tailscale 상태만 확인합니다. 안전한 Snowball 연결과 휴대폰 페어링은 아직 활성화되지 않았습니다.` };
  const [message, detail] = messages[result?.kind] ?? messages.unrecognized;
  return { message, detail };
}
