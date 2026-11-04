import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeDevelopmentPath} from '../source-publisher-handoff.mjs';
import {draftBody} from './publisher-transport.mjs';
import {checkPr,requiredApproval} from '../../agent-os/check-demo-release.mjs';

const BASE='d50b717dc9e83ce3787aa8bdb26c3a55225a60be';
const HEAD='a'.repeat(40), DELTA='b'.repeat(64), REVIEW='c'.repeat(64);
const SCOPES=[
  'scripts/strigunov4/ASI-STRIGUNOV4-GITHUB-SNAPSHOT-20261020.test.mjs',
  'tests/telegram-live-identity-acceptance.ru.json',
  'scripts/strigunov4/ASI-STRIGUNOV4-MULTIJOB-20261020.test.mjs',
  'scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.test.mjs',
  'scripts/strigunov4/ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.test.mjs'
];
const contract=JSON.parse(fs.readFileSync('docs/agent-os/releases/strigunov4-demo.json','utf8'));
const verifiedRuns=new Set(contract.stages[0].proof);
const args=(path,body)=>({contract,changed:[path],prNumber:900,
  prBody:body,headSha:HEAD,baseHasContract:true,verifiedRuns,baseSha:BASE});
test('all five exact real owner lanes can pass protected-main source-only release without new owner approval',()=>{
 for(const [i,path] of SCOPES.entries()){
   assert.equal(nativeDevelopmentPath(path),true,path);
   const body=draftBody('native-'+i,{stage:'S4-G2',baseSha:BASE,head:HEAD,
     deltaSha256:DELTA,reviewPolicySha256:REVIEW,releaseMode:'development'});
   assert.match(body,/^Release-Stage: S4-G2\nRelease-Mode: development\n/);
   assert.equal(requiredApproval(args(path,body)),null,path);
   assert.equal(checkPr({...args(path,body),ownerApproval:false}).status,
     'SOURCE_DEVELOPMENT_ONLY',path);
   const before=draftBody('native-'+i,{stage:'S4-G2',baseSha:BASE,head:HEAD,
     deltaSha256:DELTA,reviewPolicySha256:REVIEW});
   assert.throws(()=>checkPr({...args(path,before),ownerApproval:false}),
     /PR_HAS_OUT_OF_STAGE_FILES/,path);
 }
});
test('protected live Engine paths are never relabeled as development',()=>{
 for(const path of [
   'scripts/strigunov4/execution-adapters/host-runtime.mjs',
   'scripts/strigunov4/execution-adapters/host-authority.mjs',
   'scripts/strigunov4/execution-adapters/beget-live-upgrade.py',
   'scripts/strigunov4/execution-adapters/beget-native-source-review.test.mjs',
   'scripts/strigunov4/test_beget_g2_gis.mjs',
   'src/app/api/auth/route.js',
   'tests/security-regression.json',
   'docs/agent-os/AUTONOMY_POLICY.md'
 ]){
   assert.equal(nativeDevelopmentPath(path),false,path);
   const body=draftBody('native',{stage:'S4-G2',baseSha:BASE,head:HEAD,
     deltaSha256:DELTA,reviewPolicySha256:REVIEW,releaseMode:'development'});
   assert.throws(()=>checkPr({...args(path,body),ownerApproval:false}),
     /DEVELOPMENT_PROTECTED_OR_OUT_OF_SCOPE_PATH|GOVERNANCE_CHANGE_NEEDS_VERIFIED_OWNER_ATTESTATION/,path);
 }
});
test('legacy G2 body remains byte-identical and owner CI cannot piggyback development mode',()=>{
 const r={baseSha:BASE,head:HEAD,deltaSha256:DELTA};
 const before=draftBody('legacy-test',r);
 assert.match(before,/^Release-Stage: S4-G1\nRelease-Mode: implementation\n/);
 assert.equal(before,draftBody('legacy-test',{...r,releaseMode:undefined}));
 assert.throws(()=>draftBody('invalid',{...r,stage:'S4-G2',releaseMode:'development'}),/PR_DEVELOPMENT_CLASSIFICATION/);
 assert.throws(()=>draftBody('invalid',{...r,stage:'S4-G2',
   reviewPolicySha256:REVIEW,releaseMode:'development',
   reviewMode:'OWNER_VERIFIED_CI'}),/PR_DEVELOPMENT_CLASSIFICATION/);
});
