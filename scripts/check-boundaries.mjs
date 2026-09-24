import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
export function checkBoundaries(){
 const errors=[];
 for(const entry of fs.readdirSync(path.join(root,'packages'),{withFileTypes:true}).filter(e=>e.isDirectory())){
  const dir=path.join(root,'packages',entry.name),pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const declared={...pkg.dependencies,...pkg.optionalDependencies,...pkg.peerDependencies};
  function walk(p){if(!fs.existsSync(p))return;for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else if(e.name.endsWith('.ts')){
   const source=fs.readFileSync(f,'utf8');
   for(const match of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)){
    const spec=match[1];
    if(spec.startsWith('node:'))continue;
    if(spec.startsWith('.')){if(!path.resolve(path.dirname(f),spec).startsWith(dir+path.sep))errors.push(f+': cross-package relative import '+spec);continue;}
    const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
    if(!declared[name])errors.push(f+': undeclared dependency '+name);
    if(entry.name==='plugin-sdk'||(entry.name==='core'&&spec!=='@snowball/plugin-sdk'))errors.push(f+': foundation imports implementation '+spec);
    if(/^(harness-|device-)/.test(entry.name)&&spec.startsWith('@snowball/')&&spec!=='@snowball/plugin-sdk')errors.push(f+': plugin imports non-SDK implementation '+spec);
    if(spec.startsWith('@snowball/')&&spec!==name)errors.push(f+': private package subpath '+spec);
   }
  }}}
  walk(path.join(dir,'src'));
 }
 return errors;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const errors=checkBoundaries();if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Package dependency boundaries pass (static import check only).');
}
