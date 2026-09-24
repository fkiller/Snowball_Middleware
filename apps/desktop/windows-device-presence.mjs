import path from 'node:path';
import { execFile } from 'node:child_process';

// MK20's QMK HID controller and Linux product CDC link are different USB
// functions. Observing either VID/PID never proves pairing or button control.
const script = String.raw`$ErrorActionPreference='Stop'; $ids=@(Get-PnpDevice -PresentOnly | ForEach-Object { $_.InstanceId }); 'qmk=' + [int][bool]($ids | Where-Object { $_ -match '^USB\\VID_4250&PID_426F(?:&|\\)' } | Select-Object -First 1); 'cdc=' + [int][bool]($ids | Where-Object { $_ -match '^USB\\VID_1D6B&PID_0104(?:&|\\)' } | Select-Object -First 1)`;

export async function observeMk20UsbPresence() {
  if (process.platform !== 'win32') return { qmkHidObserved: false, productCdcObserved: false };
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 10000, maxBuffer: 1024, encoding: 'utf8' },
    (error, stdout) => {
      if (error) return reject(new Error('USB presence probe failed'));
      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length !== 2 || !/^qmk=[01]$/.test(lines[0]) || !/^cdc=[01]$/.test(lines[1])) return reject(new Error('USB presence probe invalid response'));
      resolve({ qmkHidObserved: lines[0] === 'qmk=1', productCdcObserved: lines[1] === 'cdc=1' });
    }));
}
