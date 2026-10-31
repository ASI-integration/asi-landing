/** Disabled protected-base trust reader. Git bytes and signed public evidence
 * are not adoption or transport authority. The compiled caller must authenticate
 * and meter both current-main observations through the existing Publisher lane.
 * No private key, working-tree configuration, ledger write or network fallback.
 */
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {AUTHORITY_DIR} from '../strigunov4/execution-adapters/host-authority.mjs';
import {readProtectedStandingTrustSnapshot} from './release-envelope-trust-roots.mjs';

const DIR='docs/agent-os/standing-trust/';
const SHA=/^[a-f0-9]{40}$/, DIGEST=/^[a-f0-9]{64}$/;
const registryFields=['schema','repository','environment','target','issuerKeySha256',
  'verifierKeySha256','minRevocationSequence','minRevocationManifestDigest','priorRevokedEnvelopeDigests'];
const must=(ok,reason)=>{if(!ok)throw Error(reason);};
const deny=reason=>Object.freeze({status:'BLOCKED',reason,authorized:false});
const digest=x=>typeof x==='string'&&DIGEST.test(x);
function data(value,keys){
  must(value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value)),'GIT_TRUST_CONTEXT');
  const d=Object.getOwnPropertyDescriptors(value);
  must(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>
    d[k]&&Object.hasOwn(d[k],'value')),'GIT_TRUST_CONTEXT');
  return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function history(value){
  must(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=1024,
    'GIT_TRUST_CONTEXT');
  const d=Object.getOwnPropertyDescriptors(value),out=[];
  must(Reflect.ownKeys(d).length===value.length+1,'GIT_TRUST_CONTEXT');
  for(let i=0;i<value.length;i++){
    must(d[i]&&Object.hasOwn(d[i],'value')&&digest(d[i].value)&&
      (!i||d[i].value>out[i-1]),'GIT_TRUST_CONTEXT');out.push(d[i].value);
  }
  return Object.freeze(out);
}
function checkpoint(value){
  const p=data(value,['sequence','manifestDigest','revokedEnvelopeDigests']);
  must(Number.isSafeInteger(p.sequence)&&p.sequence>=0&&digest(p.manifestDigest),'GIT_TRUST_CONTEXT');
  return Object.freeze({...p,revokedEnvelopeDigests:history(p.revokedEnvelopeDigests)});
}
function mainSha(value){
  must(value&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value)),'GIT_TRUST_MAIN');
  const d=Object.getOwnPropertyDescriptors(value),c=d.commit;
  must(d.name&&Object.hasOwn(d.name,'value')&&d.name.value==='main'&&
    d.protected&&Object.hasOwn(d.protected,'value')&&d.protected.value===true&&
    c&&Object.hasOwn(c,'value')&&c.value&&typeof c.value==='object'&&
    [Object.prototype,null].includes(Object.getPrototypeOf(c.value)),'GIT_TRUST_MAIN');
  const sha=Object.getOwnPropertyDescriptor(c.value,'sha');
  must(sha&&Object.hasOwn(sha,'value')&&typeof sha.value==='string'&&SHA.test(sha.value),'GIT_TRUST_MAIN');
  return sha.value;
}

export async function readProtectedGitStandingTrustSnapshot(input={}){
  try{
    const fields=['repoRoot','baseSha','envelopeDigest','readCurrentMain','priorCheckpoint'];
    const d=Object.getOwnPropertyDescriptors(input);
    const c=data(input,[...fields,...(Object.hasOwn(d,'clock')?['clock']:[])]);
    const clock=Object.hasOwn(c,'clock')?c.clock:Date.now,prior=checkpoint(c.priorCheckpoint);
    must(typeof c.repoRoot==='string'&&path.isAbsolute(c.repoRoot)&&
      typeof c.baseSha==='string'&&SHA.test(c.baseSha)&&digest(c.envelopeDigest)&&
      typeof c.readCurrentMain==='function'&&typeof clock==='function','GIT_TRUST_CONTEXT');
    let high=-1,started;
    const now=()=>{const t=clock();must(Number.isSafeInteger(t)&&t>=0&&t>=high&&
      (started===undefined||t-started<30000),'GIT_TRUST_TIME');high=t;return t;};
    started=now();
    const remaining=()=>Math.min(5000,30000-(now()-started));
    const observe=async()=>{
      const controller=new AbortController();let timer;
      try{
        const result=await Promise.race([
          new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('GIT_TRUST_TIME'));},remaining());}),
          Promise.resolve().then(()=>c.readCurrentMain(controller.signal)),
        ]);
        now();must(!controller.signal.aborted&&mainSha(result)===c.baseSha,'GIT_TRUST_MAIN_CHANGED');
      }finally{clearTimeout(timer);controller.abort();}
    };
    await observe();
    const git=(args,maxBuffer)=>execFileSync('/usr/bin/git',['--no-replace-objects',
      '-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','protocol.allow=never',...args],{
      cwd:c.repoRoot,timeout:remaining(),maxBuffer,stdio:['ignore','pipe','pipe'],
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',
        GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1'},
    });
    const object=(sha,type,cap)=>{
      const size=git(['cat-file','-s',sha],128).toString('utf8');
      must(/^[0-9]+\n$/.test(size)&&Number(size)>0&&Number(size)<=cap,'GIT_TRUST_FILE');
      const bytes=git(['cat-file',type,sha],cap+1);
      must(bytes.length===Number(size),'GIT_TRUST_FILE');
      must(createHash('sha1').update(type+' '+bytes.length+'\0').update(bytes).digest('hex')===sha,
        'GIT_TRUST_OBJECT');return bytes;
    };
    // Authenticate the complete commit/tree/blob chain. cat-file alone does not
    // promise to rehash loose-object contents against their filename/OID.
    const commit=object(c.baseSha,'commit',1024*1024);
    const root=/^tree ([a-f0-9]{40})\n/.exec(commit.toString('utf8'));
    must(root,'GIT_TRUST_OBJECT');
    const entry=(tree,name)=>{
      let offset=0,found;
      while(offset<tree.length){
        const space=tree.indexOf(32,offset),nul=tree.indexOf(0,space+1);
        must(space>offset&&nul>space+1&&nul+21<=tree.length,'GIT_TRUST_OBJECT');
        const mode=tree.subarray(offset,space).toString('ascii');
        must(/^[0-7]{5,6}$/.test(mode),'GIT_TRUST_OBJECT');
        if(tree.subarray(space+1,nul).equals(Buffer.from(name))){
          must(!found,'GIT_TRUST_OBJECT');found={mode,sha:tree.subarray(nul+1,nul+21).toString('hex')};
        }
        offset=nul+21;
      }
      must(found,'GIT_TRUST_FILE');return found;
    };
    let tree=object(root[1],'tree',1024*1024);
    for(const dir of DIR.slice(0,-1).split('/')){
      const e=entry(tree,dir);must(e.mode==='40000','GIT_TRUST_FILE');tree=object(e.sha,'tree',1024*1024);
    }
    const readBlob=(name,cap)=>{
      const e=entry(tree,name);must(e.mode==='100644','GIT_TRUST_FILE');
      return {sha:e.sha,raw:new TextDecoder('utf-8',{fatal:true}).decode(object(e.sha,'blob',cap))};
    };
    const registry=readBlob('registry.json',65536),r=data(JSON.parse(registry.raw),registryFields);
    must(JSON.stringify(r)===registry.raw&&r.schema==='asi.standing-trust-registry.v1'&&r.repository==='ASI-integration/asi-landing'&&
      r.environment==='beget-staging'&&r.target==='pqukibofpo'&&
      digest(r.issuerKeySha256)&&digest(r.verifierKeySha256)&&r.issuerKeySha256!==r.verifierKeySha256&&
      Number.isSafeInteger(r.minRevocationSequence)&&r.minRevocationSequence>=0&&
      digest(r.minRevocationManifestDigest),'GIT_TRUST_REGISTRY');
    const previous=history(r.priorRevokedEnvelopeDigests);
    must(r.minRevocationSequence>=prior.sequence&&
      (r.minRevocationSequence!==prior.sequence||r.minRevocationManifestDigest===prior.manifestDigest)&&
      prior.revokedEnvelopeDigests.every(x=>previous.includes(x)),'GIT_TRUST_ROLLBACK');
    const expected={repository:r.repository,environment:r.environment,target:r.target,
      issuerKeySha256:r.issuerKeySha256,verifierKeySha256:r.verifierKeySha256,
      envelopeDigest:c.envelopeDigest,minRevocationSequence:r.minRevocationSequence,
      minRevocationManifestDigest:r.minRevocationManifestDigest,priorRevokedEnvelopeDigests:previous};
    const files=new Map(['owner-public.pem','standing-verifier-public.pem','standing-revocations.json']
      .map(name=>[path.join(AUTHORITY_DIR,name),name]));
    const trust=await readProtectedStandingTrustSnapshot({expected,now:now(),clock:now,
      protectedReader:async(file,cap)=>{
        must(files.has(file),'GIT_TRUST_FILE');return readBlob(files.get(file),cap).raw;
      }});
    must(trust.status==='PROTECTED_TRUST_VERIFIED','GIT_TRUST_SIGNED_SNAPSHOT');
    await observe();
    const observedAt=now();
    must(observedAt>=trust.observedAt&&observedAt<trust.revocationExpiresAt,'GIT_TRUST_TIME');
    return Object.freeze({...trust,status:'PROTECTED_GIT_TRUST_VERIFIED',authorized:false,
      baseSha:c.baseSha,registryBlobSha:registry.sha,observedAt});
  }catch(error){
    return deny(/^GIT_TRUST_[A-Z_]+$/.test(error?.message||'')?error.message:'GIT_TRUST_UNAVAILABLE');
  }
}
