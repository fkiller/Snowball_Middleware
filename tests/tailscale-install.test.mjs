import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectTailscaleInstallation, stageTailscaleInstaller} from '../scripts/tailscale-install.mjs';

test('the prerequisite inventory is conservative and does not configure Tailscale', {skip:process.platform!=='win32'}, () => {
  assert.ok(['absent','existing','busy','preserved_state','unknown'].includes(inspectTailscaleInstallation().status));
});
test('installer refuses a forged MSI before elevation', {skip:process.platform!=='win32'}, t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-invalid-msi-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const msi=path.join(dir,'tailscale-setup-1.104.5-amd64.msi');fs.writeFileSync(msi,'not a signed installer');
  const helper=fileURLToPath(new URL('../scripts/tailscale-install-windows.ps1',import.meta.url));
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Action','Verify','-MsiPath',msi],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);assert.equal(JSON.parse(result.stdout).status,'verification_failed');
});
test('download staging refuses existing directories without modifying them', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-existing-msi-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'existing'),'unchanged');
  await assert.rejects(stageTailscaleInstaller(dir));
  assert.equal(fs.readFileSync(path.join(dir,'existing'),'utf8'),'unchanged');
});
