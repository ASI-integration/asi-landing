import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildBegetCandidate} from './host-package.mjs';
import {generateKeyPairSync,sign} from 'node:crypto';
import {BEGET,AUTHORITY_DIR,loadBegetAuthority} from './host-authority.mjs';
import {closedFixture,makeClosedLoop,tick} from './closed-loop-fixture.mjs';
import {digest} from './state.mjs';

const installer=new URL('./beget-install.py',import.meta.url).pathname;
const preclaimTest=`import importlib.util,json,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mode=sys.argv[2];clock=[1000];raw=b'{}';catalog=b'[]';base='a'*40
manifest={'unitSha256':'b'*64,'sourceSha':'c'*40,'baseSha':base,'catalogSha256':m.digest(catalog)}
fence={'schema':'asi.old-writer-fence.v1','repository':'ASI-integration/asi-landing',
 'method':'REVOKED_OLD_GITHUB_INSTALLATION','oldInstallationId':1,'oldCredentialsRevoked':True,
 'outstandingTokensExpiredAt':0,'independentEvidenceSha256':'d'*64,'verifiedBy':'protected-install-review','deniedPullRequests':[531]}
invalid={'fence-schema':{'schema':'wrong'},'fence-repository':{'repository':'another/repository'},
 'fence-method':{'method':'HOST_UNREACHABLE'},'fence-installation':{'oldInstallationId':2},
 'fence-installation-type':{'oldInstallationId':True},'fence-revoked':{'oldCredentialsRevoked':False},
 'fence-expiry':{'outstandingTokensExpiredAt':1},'fence-digest':{'independentEvidenceSha256':'invalid'},
 'fence-reviewer':{'verifiedBy':'owner-assertion'},'fence-denied-pr':{'deniedPullRequests':[]}}
fence.update(invalid.get(mode,{}))
activation={'repo':'ASI-integration/asi-landing','githubApp':{'installationId':2},'host':m.HOST,'service':m.UNIT,'notBefore':0,'expiresAt':2000 if mode=='activation-expired' else 5000,
 'runtimeManifestSha256':m.digest(raw),'catalogSha256':manifest['catalogSha256'],'baseSha':base}
if mode=='fence-noncanonical-pair':activation['repo']='another/repository';fence['repository']='another/repository'
if mode=='fence-missing-repositories':activation.pop('repo');fence.pop('repository')
if mode=='fence-null-repositories':activation['repo']=None;fence['repository']=None
if mode=='fence-missing-new-installation':activation['githubApp'].pop('installationId')
new_ids={'fence-new-installation-bool':True,'fence-new-installation-zero':0,'fence-new-installation-negative':-2,
 'fence-new-installation-string':'2','fence-new-installation-fraction':2.5,'fence-new-installation-unsafe':9007199254740992,
 'fence-new-installation-null':None}
if mode in new_ids:activation['githubApp']['installationId']=new_ids[mode]
contents={'owner-public.pem':b'fixture-public','catalog.json':catalog,'node':b'fixture-node','bwrap':b'fixture-bwrap',
 'fence.json':json.dumps(fence).encode(),'activation.json':b'fixture-activation',
 'source-review.json':json.dumps({'sourceSha':manifest['sourceSha'],'result':'PASS','independent':True,'findings':0}).encode()}
# Rebind BOTH signatures to invalid bytes: these must fail parsing/semantics,
# not merely an outer digest comparison.
invalid_bytes={'fence-malformed-json':b'{','fence-extra-nan':json.dumps(dict(fence,unrelated=float('nan'))).encode(),
 'fence-utf8-bom':bytes([239,187,191])+json.dumps(fence).encode(),
 'fence-utf16':json.dumps(fence).encode('utf16'),'fence-list':b'[]','fence-null':b'null'}
if mode in invalid_bytes:contents['fence.json']=invalid_bytes[mode]
m.NODE_SHA=m.digest(contents['node']);m.BWRAP_SHA=m.digest(contents['bwrap'])
contents['native-isolation.json']=json.dumps({'host':m.HOST,'unitSha256':manifest['unitSha256'],'bwrapSha256':m.BWRAP_SHA,
 'result':'PASS','networkDenied':True,'authorityInaccessible':True}).encode()
permit={'schema':'asi.beget-install-authorization.v1','host':m.HOST,'unit':m.UNIT,'manifestSha256':m.digest(raw),
 'actions':m.ACTIONS,'notBefore':0,'expiresAt':2000 if mode=='install-expired' else 5000}
for name,field in [('fence.json','fenceSha256'),('native-isolation.json','nativeIsolationSha256'),
 ('source-review.json','sourceReviewSha256'),('activation.json','activationSha256')]:permit[field]=m.digest(contents[name])
activation['fenceSha256']=m.digest(contents['fence.json']) if mode!='fence-activation-hash' else 'e'*64
calls=[];claims=[]
def call(args,**kwargs):
 assert args==['/usr/bin/git','ls-remote','https://github.com/ASI-integration/asi-landing.git','refs/heads/main']
 calls.append(args);clock[0]=2000
 if mode=='fence-replaced':contents['fence.json']=json.dumps(dict(fence,oldCredentialsRevoked=False)).encode()
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
 patch.object(m.Path,'mkdir',side_effect=AssertionError('unexpected directory mutation')), \
 patch.object(m.os,'chown',side_effect=AssertionError('unexpected ownership mutation')), \
 patch.object(m.os,'chmod',side_effect=AssertionError('unexpected mode mutation')), \
 patch.object(m,'write_new',side_effect=write):
 try:m.apply(Path('/fixture-package'),Path('/fixture-node/node'),Path('/fixture-bwrap/bwrap'));raise AssertionError('unexpected return')
 except m.Block as e:
  assert mode!='valid',str(e)
  expected=('INSTALL_ADMISSION' if mode=='install-expired' else 'ACTIVATION_WINDOW_OR_HOST' if mode=='activation-expired' else
   'PROTECTED_EVIDENCE_CHANGED' if mode in ('fence-replaced','fence-activation-hash') else 'OLD_WRITER_FENCING_UNVERIFIED')
  assert str(e)==expected,str(e)
  assert claims==[],'rejected preclaim consumed a claim'
 except StopAtClaim:
  assert mode=='valid' and len(claims)==1
  assert claims[0][1]=={'manifestSha256':m.digest(raw),'at':2000,'oneUse':True}
assert len(calls)==1,'fixture did not reach the slow Git check'
# call() rejects every non-read-only command; StopAtClaim prevents all resource writes.

`;

for(const mode of ['install-expired','activation-expired','valid']){
  test(`preclaim uses fresh time after slow Git verification: ${mode}`,()=>{
    execFileSync('/usr/bin/python3',['-I','-S','-B','-c',preclaimTest,installer,mode],{timeout:5000,stdio:'pipe'});
  });
}

test('actual installer rejects invalid or replaced fence before claim and host mutations',()=>{
  for(const mode of ['fence-schema','fence-repository','fence-method','fence-installation','fence-installation-type',
    'fence-revoked','fence-expiry','fence-digest','fence-reviewer','fence-denied-pr','fence-activation-hash','fence-replaced',
    'fence-malformed-json','fence-extra-nan','fence-utf8-bom','fence-utf16','fence-list','fence-null',
    'fence-noncanonical-pair','fence-missing-repositories','fence-null-repositories','fence-missing-new-installation',
    'fence-new-installation-bool','fence-new-installation-zero','fence-new-installation-negative',
    'fence-new-installation-string','fence-new-installation-fraction','fence-new-installation-unsafe','fence-new-installation-null']){
    execFileSync('/usr/bin/python3',['-I','-S','-B','-c',preclaimTest,installer,mode],{timeout:5000,stdio:'pipe'});
  }
});

test('installer signed verifier rejects a real invalid Ed25519 signature',()=>{
  const {publicKey}=generateKeyPairSync('ed25519'); // Isolated test key, never a live credential.
  const code=`import importlib.util,json,sys,subprocess,base64
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
envelope=json.dumps({'payload':'{"fixture":true}','signature':base64.b64encode(bytes(64)).decode()}).encode()
with patch.object(m,'regular_bytes',return_value=envelope):
 try:m.signed('fixture.json',sys.stdin.buffer.read())
 except subprocess.CalledProcessError:pass
 else:raise AssertionError('invalid signature accepted')
`;
  execFileSync('/usr/bin/python3',['-I','-S','-B','-c',code,installer],{
    input:publicKey.export({type:'spki',format:'pem'}),timeout:5000,stdio:['pipe','pipe','pipe']});
});

test('installer signed verifier accepts a real valid Ed25519 signature',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'); // Isolated fixture only.
  const payload='{"fixture":true}';
  const envelope=JSON.stringify({payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')});
  const code=`import importlib.util,sys
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with patch.object(m,'regular_bytes',return_value=sys.argv[2].encode()):
 assert m.signed('fixture.json',sys.stdin.buffer.read())=={'fixture':True}
`;
  execFileSync('/usr/bin/python3',['-I','-S','-B','-c',code,installer,envelope],{
    input:publicKey.export({type:'spki',format:'pem'}),timeout:5000,stdio:['pipe','pipe','pipe']});
});

async function actualAuthorityFixture(t,f,override={}){
  const fence={schema:'asi.old-writer-fence.v1',repository:'ASI-integration/asi-landing',
    method:'REVOKED_OLD_GITHUB_INSTALLATION',oldInstallationId:1,oldCredentialsRevoked:true,
    outstandingTokensExpiredAt:f.policy.notBefore,independentEvidenceSha256:'d'.repeat(64),
    verifiedBy:'protected-install-review',deniedPullRequests:[531],...override};
  const files={'catalog.json':JSON.stringify(f.catalog),'fence.json':JSON.stringify(fence),'reviews.json':'{}'};
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'); // Isolated fixture key, never a live grant.
  const payload={schema:'asi.engine-beget-activation.v1',...BEGET,repo:'ASI-integration/asi-landing',stage:'S4-G2',
    baseSha:f.sha,notBefore:f.policy.notBefore,expiresAt:f.policy.expiresAt,automaticCiApproved:true,automaticReviewApproved:true,
    budget:{paidUsd:0,maxTasks:2,maxMutations:8,maxRequests:1000},githubApp:{appId:1,installationId:2},
    closedLoop:{continuous:true,reviewMode:'signed-offline-delta',intervalMs:600000,maxTicks:8,policy:f.policy},
    ciPolicies:[{name:'validate',workflowId:311380800,event:'pull_request'},
      {name:'release_governance',workflowId:390653294,event:'pull_request_target'}],
    runtimeManifestSha256:'a'.repeat(64),releaseSha256:'b'.repeat(64),catalogSha256:digest(files['catalog.json']),
    fenceSha256:digest(files['fence.json']),reviewsSha256:digest(files['reviews.json'])};
  const raw=JSON.stringify(payload);
  files['activation.json']=JSON.stringify({payload:raw,signature:sign(null,Buffer.from(raw),privateKey).toString('base64')});
  files['owner-public.pem']=publicKey.export({type:'spki',format:'pem'});
  const realpath=fs.realpath.bind(fs),lstat=fs.lstat.bind(fs),open=fs.open.bind(fs);
  const authorityFile=name=>typeof name==='string'&&name.startsWith(AUTHORITY_DIR+'/');
  // Only the root-owned file boundary is modelled; actual signed loader, artifact
  // pinning, revalidation and fencingWitness run unchanged. No /etc file is read/written.
  t.mock.method(Date,'now',()=>f.now.value);
  t.mock.method(fs,'realpath',async name=>authorityFile(name)?name:realpath(name));
  t.mock.method(fs,'lstat',async name=>['/', '/etc',AUTHORITY_DIR].includes(name)?
    {uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false}:lstat(name));
  t.mock.method(fs,'open',async(name,...args)=>{
    if(!authorityFile(name))return open(name,...args);
    const bytes=files[path.basename(name)];assert.equal(typeof bytes,'string');
    return {stat:async()=>({uid:0,nlink:1,mode:0o100600,size:Buffer.byteLength(bytes),isFile:()=>true}),
      readFile:async()=>bytes,close:async()=>{}};
  });
  return {authority:await loadBegetAuthority(),files,payload};
}

test('real native fencing witness blocks invalid evidence before any fixture publication',async t=>{
  const cases=[['schema',{schema:'wrong'}],['same installation',{oldInstallationId:2}],
    ['not revoked',{oldCredentialsRevoked:false}],['outstanding token',{outstandingTokensExpiredAt:1000000}],
    ['invalid evidence digest',{independentEvidenceSha256:'invalid'}],['historical PR not denied',{deniedPullRequests:[]}]];
  for(const [name,override] of cases)await t.test(name,async t=>{
    const f=await closedFixture(t,{beget:true,distinctWorkOrders:true});
    const {authority}=await actualAuthorityFixture(t,f,override);
    await assert.rejects(authority.fencingWitness,/OLD_WRITER_FENCING_UNVERIFIED/);
    const engine=await makeClosedLoop(f,{enginePilot:false,intervalMs:600000,fencingWitness:authority.fencingWitness});
    assert.equal((await tick(engine)).mode,'FAILED_LOCKED');
    assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);assert.equal(f.pulls.size,0);
    f.now.value+=600000;
    assert.equal((await tick(engine)).mode,'FAILED_LOCKED');
    assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);assert.equal(f.pulls.size,0);
  });
});

test('real fencing witness accepts its bound record and rejects replacement after load',async t=>{
  const f=await closedFixture(t,{beget:true,distinctWorkOrders:true});
  const {authority,files,payload}=await actualAuthorityFixture(t,f);
  assert.deepEqual(await authority.fencingWitness(),{sha256:payload.fenceSha256});
  files['fence.json']=JSON.stringify({...JSON.parse(files['fence.json']),oldCredentialsRevoked:false});
  await assert.rejects(authority.fencingWitness,/BEGET_ARTIFACT_CHANGED/);
  const engine=await makeClosedLoop(f,{enginePilot:false,intervalMs:600000,fencingWitness:authority.fencingWitness});
  assert.equal((await tick(engine)).mode,'FAILED_LOCKED');
  assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);assert.equal(f.pulls.size,0);
});

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
