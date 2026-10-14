// Task 28: reproducible read-only audit of exactly six unmerged PR heads.
// This file runs ONLY on a disposable GitHub-hosted PR merge candidate.
// It does not authenticate an operator, grant permission, contact production,
// install a service, or write outside a sanitized local audit report.
import {execFileSync} from 'node:child_process';
import {writeFileSync,statSync} from 'node:fs';

export const BASE_MAIN='9bc8175aa772e92366c7a2363e26900a042fc3ce';
export const PULLS=Object.freeze([
  {
    "pr": 440,
    "branch": "asi/task22-custodian-boundary-preflight-20261014",
    "head": "6752def66167f7940b0746cfc08447e02955a33e",
    "files": [
      ".github/workflows/strigunov-task22-custodian-review.yml",
      "docs/ops/strigunov-task22-custodian-boundary.md",
      "scripts/__tests__/strigunov-task22-custodian-review.test.mjs",
      "scripts/acceptance/strigunov-task22-custodian-review.mjs"
    ]
  },
  {
    "pr": 441,
    "branch": "asi/task23-hetzner-cloud-custodian-preflight-20261014",
    "head": "0a8c5003bb687729ea7a93c8f15a92a8138bbc4b",
    "files": [
      ".github/workflows/strigunov-task23-cloud-custodian.yml",
      "docs/ops/strigunov-task23-cloud-custodian.md",
      "scripts/__tests__/strigunov-task23-cloud-custodian.test.mjs",
      "scripts/acceptance/strigunov-task23-cloud-custodian.mjs"
    ]
  },
  {
    "pr": 442,
    "branch": "asi/task24-offline-cloud-broker-protocol-20261014",
    "head": "7b6282f3106a534afc536f266b488232ab687e30",
    "files": [
      ".github/workflows/strigunov-task24-offline-broker.yml",
      "docs/ops/strigunov-task24-cloud-handoff.json",
      "docs/ops/strigunov-task24-offline-broker-contract.md",
      "scripts/__tests__/strigunov-task24-offline-broker.test.mjs",
      "scripts/acceptance/strigunov-task24-offline-broker.mjs"
    ]
  },
  {
    "pr": 443,
    "branch": "asi/task25-disposable-durable-ledger-ipc-20261014",
    "head": "79fae4e4db8cd76bf0783bb33f6a579034d8a87d",
    "files": [
      ".github/workflows/strigunov-task25-local-durability.yml",
      "docs/ops/strigunov-task25-host-boundary.json",
      "docs/ops/strigunov-task25-local-contract.md",
      "scripts/__tests__/strigunov-task25-local-ledger.test.mjs",
      "scripts/acceptance/strigunov-task25-local-ipc.mjs",
      "scripts/acceptance/strigunov-task25-local-ledger.mjs"
    ]
  },
  {
    "pr": 444,
    "branch": "asi/task26-kernel-peer-ipc-proof-20261014",
    "head": "822faea19477801987695a5c47d99e666ac2886c",
    "files": [
      ".github/workflows/strigunov-task26-peer-gate.yml",
      "docs/ops/strigunov-task26-peer-boundary.md",
      "scripts/__tests__/strigunov-task26-peer-gate.test.py",
      "scripts/acceptance/strigunov-task26-peer-gate.py"
    ]
  },
  {
    "pr": 445,
    "branch": "asi/task27-owner-release-bundle-offline-20261014",
    "head": "2dbce088ad8f8298a5c349224e10b19741610a00",
    "files": [
      ".github/workflows/strigunov-task27-release.yml",
      "docs/ops/strigunov-task27-release-contract.md",
      "scripts/__tests__/strigunov-task27-release.test.py",
      "scripts/acceptance/strigunov-task27-release.py"
    ]
  }
]);
const expectedPaths=PULLS.flatMap(p=>p.files);
const expectedSet=new Set(expectedPaths);
const fail=x=>{throw Object.assign(new Error(x),{code:x});};
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const receipt=(status,details={})=>({
 schema:1,task:28,status,source:'SYNTHETIC_COMBINED_SOURCE_AUDIT',
 base:BASE_MAIN,prHeads:PULLS.map(({pr,head})=>({pr,head})),
 runtimeWiring:'NOT_VERIFIED',ownerCustodian:'NOT_INSTALLED',
 cloudDeployment:'NOT_RUN',operatorAuthority:'BLOCK',phase2:'NOT_RUN',
 canApprove:false,canIssueReceipt:false,canSend:false,pilot:'NOT_LIVE',...details
});
export function inspectPinnedRefs(){
 const errors=[];
 const main=git('rev-parse','refs/remotes/origin/main');
 if(main!==BASE_MAIN)errors.push('BASE_DRIFT');
 if(new Set(expectedPaths).size!==expectedPaths.length||expectedPaths.length!==27)
  errors.push('OVERLAPPING_OR_MISSING_EXPECTED_FILES');
 const actual=[];
 for(const entry of PULLS){
  try{
   const observed=git('rev-parse','refs/remotes/origin/'+entry.branch);
   actual.push({pr:entry.pr,head:observed});
   if(observed!==entry.head)errors.push('PR'+entry.pr+'_HEAD_DRIFT');
   if(git('merge-base',BASE_MAIN,entry.head)!==BASE_MAIN)
    errors.push('PR'+entry.pr+'_BASE_NOT_SHARED');
  }catch{errors.push('PR'+entry.pr+'_REF_UNVERIFIED');}
 }
 return receipt(errors.length?'BLOCK':'HEADS_PINNED_ONLY',{
  problems:errors,observedHeads:actual,
  runtimeWiring:'NOT_EVALUATED',mergeSimulated:false
 });
}
export function inspectCombinedTree(){
 const pre=inspectPinnedRefs();
 if(pre.status!=='HEADS_PINNED_ONLY')return receipt('BLOCK',{problems:pre.problems});
 const files=git('diff','--cached','--name-only','HEAD').split('\n').filter(Boolean);
 const problems=[];
 if(files.length!==27||new Set(files).size!==27)problems.push('ADDED_FILE_COUNT');
 for(const f of files)if(!expectedSet.has(f))problems.push('UNREVIEWED_PATH');
 for(const entry of PULLS){
  for(const path of entry.files){
   if(!files.includes(path))problems.push('MISSING_PR_SOURCE');
   try{
    if(!statSync(path).isFile())problems.push('NOT_REGULAR_SOURCE');
    // Names alone are insufficient: cross-check Git index *and* worktree bytes
    // and executable modes against the reviewed source commit for each PR.
    const pinnedBlob=git('rev-parse',entry.head+':'+path);
    const stagedBlob=git('rev-parse',':'+path);
    const worktreeBlob=git('hash-object','--',path);
    if(stagedBlob!==pinnedBlob)problems.push('STAGED_BLOB_DRIFT_PR'+entry.pr);
    if(worktreeBlob!==pinnedBlob)problems.push('WORKTREE_BLOB_DRIFT_PR'+entry.pr);
    const pinnedMode=git('ls-tree',entry.head,'--',path).split(' ')[0];
    const stagedMode=git('ls-files','--stage','--',path).split(' ')[0];
    if(pinnedMode!==stagedMode)problems.push('FILE_MODE_DRIFT_PR'+entry.pr);
   }catch{problems.push('PINNED_BLOB_OR_MODE_UNVERIFIED_PR'+entry.pr);}
  }
 }
 const changedProductPaths=files.filter(x=>!(
  x.startsWith('scripts/acceptance/')||
  x.startsWith('scripts/__tests__/')||
  x.startsWith('docs/ops/')||
  x.startsWith('.github/workflows/')
 ));
 if(changedProductPaths.length)problems.push('UNEXPECTED_RUNTIME_WIRING');
 return receipt(problems.length?'BLOCK':'COMBINED_CODE_TREE_ONLY',{
  problems,combinedFiles:files.length,pullRequests:PULLS.length,
  cleanOctopusSimulation:true,
  runtimeWiring:'NO_PRODUCT_CODE_CHANGED',
  mergeSimulated:true,
  sourceTestsScheduled:149,
  sourceTestsActuallyPassed:'VERIFY_SEPARATELY_IN_JOB'
 });
}
const mode=process.argv[2];
try{
 const r=mode==='--preflight'?inspectPinnedRefs():
   mode==='--combined'?inspectCombinedTree():fail('INVALID_MODE');
 if(mode==='--combined')writeFileSync('strigunov-task28-audit-result.json',JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify({status:r.status,problems:r.problems,
  combinedFiles:r.combinedFiles??0,prs:r.prHeads.length,canSend:false}));
 if(r.status==='BLOCK')process.exitCode=1;
}catch(e){
 const reason=['INVALID_MODE','BASE_DRIFT','READ_FAILED'].includes(e?.code)?e.code:'INDEPENDENT_AUDIT_FAILED';
 console.error('TASK28_HOLD '+reason);
 process.exitCode=1;
}
