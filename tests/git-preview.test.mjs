import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitProvider } from '../scripts/context-manager.mjs';

test('Git diff handles shell syntax, Unicode, whitespace and staged renames as literal filenames', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'snowball-git-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,windowsHide:true});
  try {
    git('init');
    const name='한글 $(touch SNOWBALL_MARKER).txt';
    fs.writeFileSync(path.join(root,name),'first\n');
    git('add','--',name);
    git('-c','user.name=Review','-c','user.email=review@example.invalid','commit','-m','fixture');
    fs.appendFileSync(path.join(root,name),'second\n');
    const changed=await GitProvider.getChangedFiles(root);
    assert.equal(changed[0].path,name);
    assert.ok((await GitProvider.getFileDiff(name,root)).includes('+second'));
    assert.equal(fs.existsSync(path.join(root,'SNOWBALL_MARKER')),false);
    git('add','--',name);
    git('-c','user.name=Review','-c','user.email=review@example.invalid','commit','-m','updated fixture');
    git('mv','--',name,'renamed 한글.txt');
    const renamed=await GitProvider.getChangedFiles(root);
    assert.equal(renamed.length,1);
    assert.equal(renamed[0].path,'renamed 한글.txt');
    assert.match(renamed[0].status,/R/);
    assert.deepEqual(await GitProvider.getFileDiff('../outside',root),['File is outside the selected project']);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('Git diff resolves an aliased project root while rejecting linked files outside it', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snowball-git-alias-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'project'), alias = path.join(directory, 'alias');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(project); fs.mkdirSync(outside);
  fs.symlinkSync(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const git = (...args) => execFileSync('git', args, { cwd: alias, windowsHide: true });
  git('init');
  fs.writeFileSync(path.join(project, 'inside.txt'), 'first\n');
  git('add', '--', 'inside.txt');
  git('-c', 'user.name=Review', '-c', 'user.email=review@example.invalid', 'commit', '-m', 'fixture');
  fs.appendFileSync(path.join(project, 'inside.txt'), 'second\n');
  assert.ok((await GitProvider.getFileDiff('inside.txt', alias)).includes('+second'));

  fs.writeFileSync(path.join(outside, 'private.txt'), 'outside content\n');
  fs.symlinkSync(outside, path.join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const rejected = ['File is outside the selected project'];
  assert.deepEqual(await GitProvider.getFileDiff('escape/private.txt', alias), rejected);
  assert.deepEqual(await GitProvider.getFileDiff('../outside/private.txt', alias), rejected);
});
