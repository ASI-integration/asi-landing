import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOperationsPayload, operationCard, type OperationsPayload, type OperationsStored } from '../operations';
vi.mock('server-only',()=>({}));
const now=Date.now();
export function fixture(): OperationsPayload {
  return {schemaVersion:'asi.operations.v1',observedAt:new Date(now).toISOString(),records:['backup-gh','server-backups','runtime-worker'].map(id=>({id,status:'UNKNOWN',sourceUpdatedAt:null,process:'UNKNOWN',task:'UNKNOWN',completed:null,total:null,bytes:null,totalBytes:null,errors:null,archives:[]}))} as OperationsPayload;
}
const stored=():OperationsStored=>({...fixture(),receivedAt:new Date(now).toISOString()});
afterEach(()=>vi.unstubAllEnvs());
describe('operations observation boundary',()=>{
  it('missing data remains UNKNOWN with no invented percentages or update timestamp',()=>{
    const c=operationCard('backup-gh',null,now);expect(c.status).toBe('UNKNOWN');expect(c.completed).toBeNull();expect(c.sourceUpdatedAt).toBeNull();
  });
  it.each(['C:\\Users\\Admin\\key.pem','/home/admin/private','Bearer secret-token','raw exception'])('rejects extra untrusted text: %s',bad=>{
    const p=fixture();Object.assign(p.records[0],{message:bad});expect(parseOperationsPayload(p)).toBeNull();
  });
  it('rejects extra top-level fields, invalid/future source times, progress, duplicate identities and forged DONE',()=>{
    expect(parseOperationsPayload({...fixture(),secret:'hidden'})).toBeNull();
    for(const mutation of [{status:['DONE']},{process:['PRESENT']},{task:['ACTIVE']},{completed:-1},{total:1,completed:2},{sourceUpdatedAt:'now'},{sourceUpdatedAt:new Date(now+60000).toISOString()},{status:'DONE',completed:1,total:2,errors:0}]){
      const p=fixture();Object.assign(p.records[0],mutation);expect(parseOperationsPayload(p)).toBeNull();
    }
    const p=fixture();p.records[1]=p.records[0];expect(parseOperationsPayload(p)).toBeNull();
  });
  it('a reporter heartbeat cannot freshen a frozen backup summary',()=>{
    const p=stored();Object.assign(p.records[0],{status:'RUNNING',sourceUpdatedAt:new Date(now-121000).toISOString(),completed:5,total:20});
    const c=operationCard('backup-gh',p,now);expect(c.status).toBe('STALE');expect(c.completed).toBe(5);
  });
  it('transport outage expires even a previously DONE report; source verification time is retained',()=>{
    const p=stored();p.observedAt=p.receivedAt=new Date(now-121000).toISOString();p.records[1].sourceUpdatedAt=new Date(now-3600000).toISOString();
    expect(operationCard('server-backups',p,now).status).toBe('STALE');expect(operationCard('server-backups',p,now).sourceUpdatedAt).toBe(p.records[1].sourceUpdatedAt);
  });
  it('worker presence never proves work completion or task activity',()=>{
    const p=stored();Object.assign(p.records[2],{status:'RUNNING',process:'PRESENT',sourceUpdatedAt:p.observedAt});
    expect(parseOperationsPayload({schemaVersion:p.schemaVersion,observedAt:p.observedAt,records:p.records})).not.toBeNull();
    expect(operationCard('runtime-worker',p,now).task).toBe('UNKNOWN');p.records[2].task='ACTIVE';expect(parseOperationsPayload({schemaVersion:p.schemaVersion,observedAt:p.observedAt,records:p.records})).toBeNull();
  });
  it('archive DONE requires exactly four distinct checked SHA256 records',()=>{
    const p=fixture();Object.assign(p.records[1],{status:'DONE',sourceUpdatedAt:p.observedAt,completed:4,total:4,errors:0});
    expect(parseOperationsPayload(p)).toBeNull();
    p.records[1].archives=['core','video','releases','supplemental'].map(batch=>({batch,sha256:'a'.repeat(64),bytes:1})) as typeof p.records[1]['archives'];
    expect(parseOperationsPayload(p)).not.toBeNull();Object.assign(p.records[1].archives[0],{path:'/private'});expect(parseOperationsPayload(p)).toBeNull();
  });
  it('persists only observations across module restart, refuses replay and never changes existing task files',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-operations-'));vi.stubEnv('COMM_STATE_DIR',root);
    try{
      const dir=path.join(root,'mission-control');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'asi.json'),'existing runtime status');
      const {saveOperations}=await import('../operations-store');await saveOperations(fixture());await expect(saveOperations(fixture())).rejects.toThrow('OLD_OBSERVATION');
      vi.resetModules();const {readOperations}=await import('../operations-store');expect((await readOperations())?.records).toEqual(fixture().records);
      expect(await fs.readFile(path.join(dir,'asi.json'),'utf8')).toBe('existing runtime status');
      const saved=JSON.parse(await fs.readFile(path.join(dir,'operations.json'),'utf8'));saved.records[0].privateKey='SECRET';await fs.writeFile(path.join(dir,'operations.json'),JSON.stringify(saved));expect(await readOperations()).toBeNull();
    }finally{await fs.rm(root,{recursive:true,force:true});}
  });
  it('concurrent reports serialize without a persistent lock, and new reports work after restart',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-operations-'));vi.stubEnv('COMM_STATE_DIR',root);
    try {
      const {saveOperations}=await import('../operations-store');const newer=fixture();newer.observedAt=new Date(now+1).toISOString();
      const results=await Promise.allSettled([saveOperations(newer),saveOperations(fixture())]);
      expect(results.map(x=>x.status)).toEqual(['fulfilled','rejected']);
      expect(await fs.readdir(path.join(root,'mission-control'))).toEqual(['operations.json']);
      vi.resetModules();const restarted=await import('../operations-store');newer.observedAt=new Date(now+2).toISOString();await restarted.saveOperations(newer);
      expect((await restarted.readOperations())?.observedAt).toBe(newer.observedAt);
    } finally {await fs.rm(root,{recursive:true,force:true});}
  });
});
