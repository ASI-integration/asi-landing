import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildBegetCandidate} from './host-package.mjs';

const installer=new URL('./beget-install.py',import.meta.url).pathname;
const preclaimTest=`import importlib.util,json,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mode=sys.argv[2];clock=[1000];raw=b'{}';catalog=b'[]';base='a'*40
manifest={'unitSha256':'b'*64,'sourceSha':'c'*40,'baseSha':base,'catalogSha256':m.digest(catalog)}
activation={'host':m.HOST,'service':m.UNIT,'notBefore':0,'expiresAt':2000 if mode=='activation-expired' else 5000,
 'runtimeManifestSha256':m.digest(raw),'catalogSha256':manifest['catalogSha256'],'baseSha':base}
contents={'owner-public.pem':b'fixture-public','catalog.json':catalog,'node':b'fixture-node','bwrap':b'fixture-bwrap',
 'fence.json':b'fixture-fence','activation.json':b'fixture-activation',
 'source-review.json':json.dumps({'sourceSha':manifest['sourceSha'],'result':'PASS','independent':True,'findings':0}).encode()}
m.NODE_SHA=m.digest(contents['node']);m.BWRAP_SHA=m.digest(contents['bwrap'])
contents['native-isolation.json']=json.dumps({'host':m.HOST,'unitSha256':manifest['unitSha256'],'bwrapSha256':m.BWRAP_SHA,
 'result':'PASS','networkDenied':True,'authorityInaccessible':True}).encode()
permit={'schema':'asi.beget-install-authorization.v1','host':m.HOST,'unit':m.UNIT,'manifestSha256':m.digest(raw),
 'actions':m.ACTIONS,'notBefore':0,'expiresAt':2000 if mode=='install-expired' else 5000}
for name,field in [('fence.json','fenceSha256'),('native-isolation.json','nativeIsolationSha256'),
 ('source-review.json','sourceReviewSha256'),('activation.json','activationSha256')]:permit[field]=m.digest(contents[name])
calls=[];claims=[]
def call(args,**kwargs):
 assert args==['/usr/bin/git','ls-remote','https://github.com/ASI-integration/asi-landing.git','refs/heads/main']
 calls.append(args);clock[0]=2000
 return (base+'\\trefs/heads/main\\n').encode()
class StopAtClaim(Exception):pass
def write(p,data,**kwargs):claims.append((p,json.loads(data)));raise StopAtClaim()
with patch.object(m,'prepared',return_value=(raw,manifest,{'catalog.json':catalog})), \
 patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'uname',return_value=SimpleNamespace(nodename=m.HOST)), \
 patch.object(m,'regular_bytes',side_effect=lambda p,**kwargs:contents[Path(p).name]), \
 patch.object(m,'signed',side_effect=lambda name,public:permit if name=='install-approval.json' else activation), \
 patch.object(m.time,'time',side_effect=lambda:clock[0]/1000),patch.object(m,'authority_traversal'), \
 patch.object(m,'inactive'),patch.object(m.Path,'exists',return_value=False), \
 patch.object(m.pwd,'getpwnam',side_effect=KeyError),patch.object(m,'call',side_effect=call), \
 patch.object(m,'write_new',side_effect=write):
 try:m.apply(Path('/fixture-package'),Path('/fixture-node/node'),Path('/fixture-bwrap/bwrap'));raise AssertionError('unexpected return')
 except m.Block as e:
  assert mode!='valid',str(e)
  assert str(e)==('INSTALL_ADMISSION' if mode=='install-expired' else 'ACTIVATION_WINDOW_OR_HOST'),str(e)
  assert claims==[],'expired admission consumed a claim'
 except StopAtClaim:
  assert mode=='valid' and len(claims)==1
  assert claims[0][1]=={'manifestSha256':m.digest(raw),'at':2000,'oneUse':True}
assert len(calls)==1,'fixture did not reach the slow Git check'
`;

for(const mode of ['install-expired','activation-expired','valid']){
  test(`preclaim uses fresh time after slow Git verification: ${mode}`,()=>{
    execFileSync('/usr/bin/python3',['-I','-S','-B','-c',preclaimTest,installer,mode],{timeout:5000,stdio:'pipe'});
  });
}

async function source(t){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'asi-package-output-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const repository=path.join(base,'source');await fs.mkdir(repository);
  const adapters=path.join(repository,'scripts/strigunov4/execution-adapters');
  await fs.mkdir(path.join(adapters,'beget-work-orders'),{recursive:true});
  // Minimal isolated source fixture; no executable installation or live work.
  await fs.writeFile(path.join(adapters,'host-runtime.mjs'),'export const fixture = true;\n');
  await fs.copyFile(new URL('../beget_g2_operator_witness.py',import.meta.url),path.join(repository,'scripts/strigunov4/beget_g2_operator_witness.py'));
  for(const name of ['identity','races'])await fs.writeFile(path.join(adapters,'beget-work-orders',name+'.py.txt'),'# fixture only\n');
  await fs.writeFile(path.join(adapters,'asi-strigunov-agent.service'),'# fixture only\n');
  await fs.writeFile(path.join(adapters,'beget-install.py'),'# fixture only\n');
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:repository,encoding:'utf8',stdio:'pipe'});
  git('init');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');git('add','.');git('commit','-m','fixture');
  return {base,repository,baseSha:git('rev-parse','HEAD').trim(),git};
}

test('candidate rejects repository root and nested output before creating any file',async t=>{
  const f=await source(t),output=path.join(f.repository,'package');
  for(const dest of [f.repository,output,path.join(f.repository,'scripts','package')]){
    await assert.rejects(()=>buildBegetCandidate({...f,output:dest}),/PACKAGE_OUTPUT_IN_SOURCE/);
  }
  await assert.rejects(()=>fs.stat(output),{code:'ENOENT'});
  await assert.rejects(()=>fs.stat(path.join(f.repository,'scripts','package')),{code:'ENOENT'});
  assert.equal(f.git('status','--porcelain'),'');
});

test('canonical parent catches output entering source through a symlink alias',async t=>{
  const f=await source(t),alias=path.join(f.base,'alias');await fs.symlink(f.repository,alias);
  await assert.rejects(()=>buildBegetCandidate({...f,output:path.join(alias,'package')}),/PACKAGE_OUTPUT_IN_SOURCE/);
  await assert.rejects(()=>fs.stat(path.join(f.repository,'package')),{code:'ENOENT'});
  assert.equal(f.git('status','--porcelain'),'');
});

test('sibling output sharing the source-name prefix remains allowed and source stays clean',async t=>{
  const f=await source(t),output=f.repository+'-package';
  const manifest=await buildBegetCandidate({...f,output});
  assert.equal(manifest.sourceSha,f.baseSha);assert.equal(manifest.installable,false);
  assert.equal(JSON.parse(await fs.readFile(path.join(output,'manifest.json'))).sourceSha,f.baseSha);
  assert.equal(f.git('status','--porcelain'),'');
});
