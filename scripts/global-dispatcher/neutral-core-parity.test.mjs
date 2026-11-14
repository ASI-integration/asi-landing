import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {hash,must} from './core.mjs';
import {hash as adapterHash,must as adapterMust} from './product-adapters.mjs';
import {atomicWriteJson as neutralWrite} from './atomic-json.mjs';
import {atomicWriteJson as legacyWrite} from '../strigunov4/ASI-STRIGUNOV4-ORCHESTRATOR-CANDIDATE-20261020.mjs';

test('the product-neutral core preserves adapter hashes, invariants and API',()=>{
  const val={z:[3,2,1],a:{name:'asi'}};
  assert.equal(hash(val),adapterHash(val));
  assert.equal(must,adapterMust);
  assert.throws(()=>must(false,'ASI_INVARIANT'),/ASI_INVARIANT/);
});

test('neutral atomic writer emits exactly the same JSON bytes and private mode',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-neutral-routing-'));
  await fs.chmod(root,0o700);
  try{
    const payload={schema:'asi.global-routing.v1',tick:7,
      products:[{id:'cabins',terminal:[],planned:[]}]};
    const a=path.join(root,'new.json'),b=path.join(root,'old.json');
    await neutralWrite(a,payload);
    await legacyWrite(b,payload);
    assert.equal(await fs.readFile(a,'utf8'),await fs.readFile(b,'utf8'));
    assert.deepEqual(JSON.parse(await fs.readFile(a,'utf8')),payload);
    assert.equal((await fs.stat(a)).mode&0o777,0o600);
    assert.deepEqual((await fs.readdir(root)).sort(),['new.json','old.json']);
    await neutralWrite(a,{schema:payload.schema,tick:8,products:[]});
    assert.equal(JSON.parse(await fs.readFile(a,'utf8')).tick,8);
    assert.deepEqual((await fs.readdir(root)).sort(),['new.json','old.json']);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
