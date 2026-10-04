import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const {GITHUB_REPOSITORY:repository,GITHUB_SHA:sha,GITHUB_RUN_ID:runId,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary}=process.env;
if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!/^[0-9a-f]{40}$/.test(sha??'')||!/^\d+$/.test(runId??'')||!output||!summary)
  throw new Error('Verified GitHub workflow context required');
const tag=`ci-${sha.slice(0,12)}-${runId}`;
const releases=JSON.parse(execFileSync('gh',['api',`repos/${repository}/releases?per_page=100`],{encoding:'utf8'}));
let release=releases.find(item=>item.tag_name===tag);
if(release&&(!release.draft||release.target_commitish!==sha))throw new Error('Existing CI release has a different target or is published');
if(!release){
  const body=`Unsigned desktop packages for commit ${sha}.\n\nEach platform archive and its SHA-256 are uploaded only after native tray, loopback and pause checks pass for both the package and the extracted archive. A missing platform asset means its job is incomplete or failed; inspect the workflow before using the packages.\n\nWorkflow: https://github.com/${repository}/actions/runs/${runId}\n`;
  release=JSON.parse(execFileSync('gh',['api','--method','POST',`repos/${repository}/releases`,'--input','-'],{
    encoding:'utf8',input:JSON.stringify({tag_name:tag,target_commitish:sha,name:`Desktop CI ${sha.slice(0,12)}`,draft:true,prerelease:true,body}),
  }));
}
fs.appendFileSync(output,`tag=${tag}\n`);
fs.appendFileSync(summary,`Verified desktop archives will be stored in [this draft release](${release.html_url}) after each platform's checks pass.\n`);
console.log(JSON.stringify({tag,url:release.html_url,draft:release.draft,target:release.target_commitish}));
