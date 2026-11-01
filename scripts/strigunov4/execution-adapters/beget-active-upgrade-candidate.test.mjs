import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildRuntimeClosure} from './host-package.mjs';
import {inspectExistingRuntimeManifest,STANDING_RUNTIME_ROOTS,
  buildActiveStandingUpgradeCandidate} from './beget-active-upgrade-candidate.mjs';
const HASH=s=>s.repeat(64),SHA=s=>s.repeat(40);
const old=()=>JSON.stringify({
  schema:'asi.beget-engine-source.v1',sourceSha:SHA('0'),baseSha:SHA('a'),
  entry:'scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs',
  installable:false,
  catalogSha256:HASH('c'),unitSha256:HASH('d'),
  files:Array.from({length:19},(_,i)=>({
    path:'scripts/strigunov4/execution-adapters/legacy-'+i+'.mjs',sha256:HASH('f')
  }))
})+'\n';
test('existing manifest is source-only evidence, not a signer',()=>{
  const r=inspectExistingRuntimeManifest(old());
  assert.equal(r.status,'OBSERVED_SOURCE_CANDIDATE');
  assert.equal(r.authorized,false);
  assert.equal(r.installable,false);
  assert.equal(r.oldSourceSha,SHA('0'));
  assert.equal(r.oldFiles.length,19);
  assert.match(r.oldManifestSha256,/^[a-f0-9]{64}$/);
});
test('a duplicate file path or path traversal blocks old generation claim',()=>{
  const duplicate=JSON.parse(old());
  duplicate.files[1].path=duplicate.files[0].path;
  assert.equal(inspectExistingRuntimeManifest(JSON.stringify(duplicate)).status,'BLOCKED');
  duplicate.files[1].path='scripts/../credentials.mjs';
  assert.equal(inspectExistingRuntimeManifest(JSON.stringify(duplicate)).status,'BLOCKED');
});
test('bad old hashes, installable true and changed schema fail closed',()=>{
  for(const change of [
    m=>{m.sourceSha='wrong'},m=>{m.schema='anything'},
    m=>{m.installable=true},m=>{m.files[0].sha256='0'},
    m=>{m.files.length=0},m=>{m.unitSha256=1}
  ]){
    const m=JSON.parse(old());change(m);
    assert.equal(inspectExistingRuntimeManifest(JSON.stringify(m)).status,'BLOCKED');
  }
});
test('malformed inputs and missing signed source identity never build',async()=>{
  assert.equal(inspectExistingRuntimeManifest('bad-json').status,'BLOCKED');
  const r=await buildActiveStandingUpgradeCandidate({repository:'/tmp/nonexistent',
    output:'/tmp/do-not-write',baseSha:SHA('a'),expectedSourceSha:'invalid',
    installedManifestRaw:old()});
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.authorized,false);
});
test('the extra roots are six exact source modules, never tests or a new agent',()=>{
  assert.equal(STANDING_RUNTIME_ROOTS.length,6);
  assert.equal(new Set(STANDING_RUNTIME_ROOTS).size,6);
  assert(STANDING_RUNTIME_ROOTS.every(p=>p.startsWith('strigunov4/execution-adapters/standing-')&&
    p.endsWith('.mjs')&&!p.includes('.test.')));
});
test('real source closure includes standing modules without changing existing code',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-standing-closure-'));
  try{
    const repository=path.resolve(import.meta.dirname,'../../..');
    const extra=path.join(root,'extra'),plain=path.join(root,'plain');
    const first=await buildRuntimeClosure({
      repository,output:extra,extraRoots:[...STANDING_RUNTIME_ROOTS]});
    const second=await buildRuntimeClosure({repository,output:plain});
    const names=Object.keys(first.files);
    for(const p of STANDING_RUNTIME_ROOTS){
      assert(names.includes(p),p);
      assert((await fs.readFile(path.join(extra,'scripts',p),'utf8')).length>0);
    }
    assert(names.length>=Object.keys(second.files).length);
    for(const n of Object.keys(second.files))
      assert.equal(first.files[n],second.files[n],n);
    assert.equal(first.installable,false);
    assert.equal(second.installable,false);
    assert(!names.some(n=>n.includes('.test.')));
  } finally {await fs.rm(root,{recursive:true,force:true})}
});
test('unexpected root, duplicate roots and test file remain excluded',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-standing-invalid-'));
  const repository=path.resolve(import.meta.dirname,'../../..');
  try {
    let i=0;
    for(const roots of [['../../unsafe.mjs'],[STANDING_RUNTIME_ROOTS[0],STANDING_RUNTIME_ROOTS[0]],
      ['strigunov4/execution-adapters/standing-budget.test.mjs']]){
      const output=path.join(root,String(i++));
      await assert.rejects(buildRuntimeClosure({repository,output,extraRoots:roots}));
    }
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
