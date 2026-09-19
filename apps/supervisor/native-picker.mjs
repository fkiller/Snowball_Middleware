import { execFile } from 'node:child_process';
import path from 'node:path';

const windowsPicker = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$workspaceDialog = New-Object System.Windows.Forms.FolderBrowserDialog
$workspaceDialog.Description = 'Choose a workspace for Snowball local file access'
$workspaceDialog.ShowNewFolderButton = $false
try {
  if ($workspaceDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write((@{ root = $workspaceDialog.SelectedPath } | ConvertTo-Json -Compress))
  } else { [Console]::Write('null') }
} finally { $workspaceDialog.Dispose() }
`;
const macPicker = `const app = Application.currentApplication(); app.includeStandardAdditions = true;
try { JSON.stringify({root: app.chooseFolder({withPrompt: 'Choose a workspace for Snowball local file access'}).toString()}); }
catch (error) { if (error.errorNumber === -128) { 'null'; } else { throw error; } }`;

/** Never receives a browser path. Opens only the explicitly requested OS directory dialog. */
export function chooseNativeWorkspace(signal) {
  if (signal.aborted) return Promise.reject(coded('workspace_selection_cancelled', 'Workspace selection cancelled'));
  let binary; let args;
  if (process.platform === 'win32') {
    binary = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    args = ['-NoProfile', '-NonInteractive', '-STA', '-Command', windowsPicker];
  } else if (process.platform === 'darwin') {
    binary = '/usr/bin/osascript'; args = ['-l', 'JavaScript', '-e', macPicker];
  } else return Promise.reject(coded('workspace_selection_unavailable', 'Native workspace selection is unavailable on this platform'));
  return new Promise((resolve, reject) => {
    execFile(binary, args, { encoding: 'utf8', windowsHide: true, signal, timeout: 115_000, maxBuffer: 16 * 1024 }, (error, output) => {
      if (error) {
        // Aborted selections and dialog timeouts never grant a root. Cancellation
        // stays 409; other native failures stay 503 without raw process output.
        if (signal.aborted) { reject(coded('workspace_selection_cancelled', 'Workspace selection cancelled')); return; }
        reject(coded('workspace_selection_unavailable', 'Native workspace selection failed'));
        return;
      }
      try {
        const selected = JSON.parse(output);
        if (selected === null) { resolve(null); return; }
        if (typeof selected.root !== 'string' || !path.isAbsolute(selected.root) || selected.root.length > 4096) throw new Error('Invalid selection');
        resolve({ root: selected.root, displayName: path.basename(selected.root) || 'Workspace' });
      } catch { reject(coded('workspace_selection_invalid', 'Native workspace selection returned invalid data')); }
    });
  });
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}
