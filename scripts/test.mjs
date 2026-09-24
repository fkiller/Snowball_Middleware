import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
// Explicit files work across supported Node versions; directory arguments do not.
const files=fs.readdirSync('tests').filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'tests/'+name);
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;
