// Prepare private, independently buildable repositories; never publishes or chooses a license.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=process.argv[2];
if(!output||!path.isAbsolute(output)||fs.existsSync(output))throw new Error('Choose a new absolute output directory');
const npm=process.env.npm_execpath;
if(!npm||!fs.existsSync(npm))throw new Error('Run with npm run export:harnesses -- ABSOLUTE_NEW_DIRECTORY');
const base=JSON.parse(fs.readFileSync(path.join(root,'tsconfig.base.json'),'utf8'));
fs.mkdirSync(output,{recursive:true});
const sdkPack=JSON.parse(execFileSync(process.execPath,[npm,'pack',path.join(root,'packages/plugin-sdk'),'--pack-destination',output,'--ignore-scripts','--json'],{encoding:'utf8',windowsHide:true}))[0];
const sdkTar=path.join(output,sdkPack.filename);
for(const name of ['harness-codex','harness-opencode','harness-antigravity']){
  const source=path.join(root,'packages',name), destination=path.join(output,name);
  fs.mkdirSync(destination);fs.cpSync(path.join(source,'src'),path.join(destination,'src'),{recursive:true,errorOnExist:true});
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  pkg.dependencies={'@snowball/plugin-sdk':`file:vendor/${sdkPack.filename}`};
  pkg.bundledDependencies=['@snowball/plugin-sdk'];
  pkg.devDependencies={'typescript':'5.9.3','@types/node':'20.19.43'};
  pkg.engines={node:'>=22.12'};pkg.files=['dist','src','README.md','vendor','docs','scripts'];
  pkg.scripts={build:'tsc -p tsconfig.json',test:'npm run build && node --test tests/protocol.test.mjs'+(name==='harness-codex'?'':' tests/adapter.test.mjs'),'test:package':'node scripts/verify-release-package.mjs'};
  fs.mkdirSync(path.join(destination,'vendor'));fs.copyFileSync(sdkTar,path.join(destination,'vendor',sdkPack.filename));
  fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  fs.writeFileSync(path.join(destination,'tsconfig.json'),JSON.stringify({...base,compilerOptions:{...base.compilerOptions,rootDir:'src',outDir:'dist'},include:['src/**/*.ts']},null,2)+'\n');
  fs.writeFileSync(path.join(destination,'.gitignore'),'node_modules/\ndist/\n*.log\n');
  fs.mkdirSync(path.join(destination,'tests'));
  const provider=name.slice(8),manifest=provider+'Manifest';
  const testSource=`import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {parseManifest} from '@snowball/plugin-sdk';
import {${manifest}} from '../dist/index.js';
test('independent worker uses SDK protocol and exits on EOF without launching a harness',async()=>{
 const m=parseManifest(await ${manifest}());
 const child=spawn(process.execPath,[m.entrypoint],{stdio:'pipe',windowsHide:true,env:{...process.env,NODE_OPTIONS:''}});
 const exited=once(child,'exit');const lines=createInterface({input:child.stdout});const output=[];child.stderr.resume();
 lines.on('line',line=>output.push(JSON.parse(line)));
 const timeout=setTimeout(()=>child.kill(),15000);
 try{
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'plugin.initialize',params:{apiVersion:'1.0.0',pluginId:m.id}})+'\\n');
  const deadline=Date.now()+12000;while(!output.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(output[0]?.result?.pluginId,m.id);assert.equal(output[0]?.result?.apiVersion,'1.0.0');
  child.stdin.end();const [code]=await exited;assert.equal(code,0);
 }finally{clearTimeout(timeout);lines.close();if(child.exitCode===null)child.kill();}
});
`;
  fs.writeFileSync(path.join(destination,'tests/protocol.test.mjs'),testSource);
  if(provider!=='codex'){
    let tests=fs.readFileSync(path.join(root,'tests',name+'.test.mjs'),'utf8');
    tests=tests.replaceAll(`../packages/${name}/dist/index.js`,'../dist/index.js').replaceAll("'../packages/core/dist/index.js'","'@snowball/plugin-sdk'");
    fs.writeFileSync(path.join(destination,'tests/adapter.test.mjs'),tests);
  }
  let existing=fs.existsSync(path.join(source,'README.md'))?fs.readFileSync(path.join(source,'README.md'),'utf8'):'';
  if(provider==='opencode'){
    fs.mkdirSync(path.join(destination,'docs'));
    fs.copyFileSync(path.join(root,'docs/middleware/OPENCODE_OWNERSHIP.md'),path.join(destination,'docs/OWNERSHIP.md'));
    fs.mkdirSync(path.join(destination,'scripts'));
    fs.copyFileSync(path.join(root,'scripts/verify-opencode-isolation.mjs'),path.join(destination,'scripts/verify-opencode-isolation.mjs'));
    existing=existing.replace(/The production owned-server design and remaining L3–L5 evidence gates are in[^\n]+/, 'The production owned-server design and remaining L3–L5 evidence gates are in `docs/OWNERSHIP.md`. Repository-wide release and license decisions remain with the publisher.');
  }
  fs.mkdirSync(path.join(destination,'scripts'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/verify-harness-release-package.mjs'),path.join(destination,'scripts/verify-release-package.mjs'));
  if(provider==='codex'){
    existing=existing.split('## Reproduce local native verification')[0].replace(/See `docs\/middleware\/CONTROL_REALITY\.md`\./, 'The original middleware repository tracks integration and release gates separately.');
  }
  fs.writeFileSync(path.join(destination,'README.md'),`# ${pkg.name}\n\nPrivate standalone export under the owner's GitHub account. No middleware or hardware checkout is required. Run \`npm ci --ignore-scripts\`, then \`npm test\`. The vendored SDK tarball is a local prerelease, not a published SDK. This UNLICENSED/private repository is for integration and reference; public redistribution or package release needs a license and release decision.\n\nTests use isolated protocol/provider fixtures, never your existing tasks or credentials. Codex real-provider acceptance and other provider limitations are documented below; protocol conformance alone does not prove control support.\n\n${existing.trimEnd()}\n`);
  fs.mkdirSync(path.join(destination,'docs'),{recursive:true});
  fs.writeFileSync(path.join(destination,'docs/INTEGRATION.md'),`# Plugin integration reference\n\nThis repository is independently buildable and intentionally does not import the Snowball middleware checkout. Its local \`vendor/snowball-plugin-sdk-0.1.0.tgz\` is the exact prerelease protocol dependency in \`package-lock.json\`; it is not a registry release. Release tarballs also bundle the installed SDK because npm cannot resolve a nested \`file:vendor/...\` dependency in a consumer project.\n\nStart with \`src/manifest.ts\` to see the plugin ID, kind, reviewed worker entrypoint, integrity digest and explicitly declared operations. The middleware's PluginHost validates the manifest, checks the entrypoint digest, starts \`src/worker.ts\` without a shell, performs \`plugin.initialize\`, and dispatches only declared JSON-RPC operations. \`tests/protocol.test.mjs\` demonstrates the independent handshake and EOF cleanup. Provider tests in \`tests/adapter.test.mjs\`, where present, test provider data separately.\n\nThe adapter in \`src/index.ts\` translates provider-specific identity, sessions, model catalog and events into the SDK contract. A listed or discovered session is read-only until the middleware explicitly attaches an owner to that exact instance/session. Commands go through the middleware's local API and durable command journal, never directly from a device plugin to a harness. Do not claim create/send/decision/interrupt operations in a new manifest until real-provider receipts and failure behavior have been verified for each operation.\n\nRun \`npm ci --ignore-scripts\` and \`npm test\` on a supported Node version (>=22.12). GitHub Actions checks both Windows and macOS builds. Those CI checks validate portable protocol/fixture behavior; they do not constitute native provider, hardware or end-user installation acceptance. The repo is private and UNLICENSED pending the owner's license decision.\n`);
  fs.mkdirSync(path.join(destination,'.github/workflows'),{recursive:true});
  fs.writeFileSync(path.join(destination,'.github/workflows/check.yml'),`name: Standalone checks\non: [push, pull_request]\njobs:\n  test:\n    strategy:\n      matrix:\n        os: [windows-latest, macos-latest]\n    runs-on: \${{ matrix.os }}\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n          cache: npm\n      - run: npm ci --ignore-scripts\n      - run: npm test\n      - run: npm run test:package\n`);
  execFileSync(process.execPath,[npm,'install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],{cwd:destination,stdio:'inherit',windowsHide:true});
}
console.log(JSON.stringify({output,repositories:3,published:false,license:'UNLICENSED',sdkIntegrity:sdkPack.integrity}));
