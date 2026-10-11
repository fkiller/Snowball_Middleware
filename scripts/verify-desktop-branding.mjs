import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {desktopRuntime} from './desktop-runtime.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function verifyDesktopBranding(executable){
  if(process.platform==='win32'){
    const {NtExecutable,NtExecutableResource,Data,Resource}=await import('resedit');
    const res=NtExecutableResource.from(NtExecutable.from(fs.readFileSync(executable),{ignoreCert:true}));
    const expected=Data.IconFile.from(fs.readFileSync(path.join(root,'assets/icon.ico'))).icons.map(i=>Buffer.from(i.data.bin));
    const groups=Resource.IconGroupEntry.fromEntries(res.entries);assert.ok(groups.length>0);
    for(const group of groups){const actual=group.getIconItemsFromEntries(res.entries);assert.equal(actual.length,expected.length);actual.forEach((icon,i)=>assert.deepEqual(Buffer.from(icon.bin),expected[i],'Executable icon differs from Snowball artwork'));}
    const version=Resource.VersionInfo.fromEntries(res.entries)[0];assert.ok(version);
    for(const language of version.getAllLanguagesForStringValues()){
      const strings=version.getStringValues(language);assert.equal(strings.ProductName,'Snowball Middleware');assert.equal(strings.FileDescription,'Snowball Middleware');assert.equal(strings.CompanyName,'Snowball');assert.equal(strings.OriginalFilename,'SnowballMiddleware.exe');
    }
    return {platform:'win32',iconGroups:groups.length,iconSizes:expected.length,productName:'Snowball Middleware'};
  }
  const app=path.resolve(path.dirname(executable),'../..'),plist=path.join(app,'Contents/Info.plist');
  const value=key=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,plist],{encoding:'utf8'}).trim();
  assert.equal(value('CFBundleName'),'Snowball Middleware');assert.equal(value('CFBundleExecutable'),'SnowballMiddleware');assert.equal(value('CFBundleIdentifier'),'local.snowball.middleware');
  const icon=path.join(app,'Contents/Resources',value('CFBundleIconFile'));
  const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(digest(icon),digest(path.join(root,'assets/icon.icns')));
  return {platform:'darwin',productName:'Snowball Middleware',bundleIcon:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await verifyDesktopBranding(process.argv[2]??desktopRuntime().executable)));
