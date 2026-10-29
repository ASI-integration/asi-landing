import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const installer=fileURLToPath(new URL('./beget-install.py',import.meta.url));
const run=(code,mode)=>execFileSync('/usr/bin/python3',
  ['-I','-S','-B','-c',code,installer,mode],
  {timeout:6500,encoding:'utf8',stdio:['ignore','pipe','pipe']});

const stageFixture=String.raw\`
import importlib.util,sys,json,stat
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mode=sys.argv[2]
raw=b'{"fixture":true}';catalog=b'[]'
manifest={'sourceSha':'a'*40,'baseSha':'b'*40,'unitSha256':'c'*64}
files={'catalog.json':catalog,m.UNIT:b'[Unit]\\nDescription=fixture\\n'}
permit={'schema':m.STAGE_SCHEMA,'host':m.HOST,'unit':m.UNIT,
'manifestSha256':m.digest(raw),'sourceSha':manifest['sourceSha'],
'baseSha':manifest['baseSha'],'unitSha256':manifest['unitSha256'],
'actions':m.STAGE_ACTIONS,'notBefore':100,'expiresAt':1000}
if mode=='wrong-action':permit['actions']=m.STAGE_ACTIONS+['enable-start-engine']
if mode=='wrong-main':manifest['baseSha']='d'*40
if mode=='expired':permit['expiresAt']=500
if mode=='wrong-unit':permit['unit']='another.service'
if mode=='wrong-source':permit['sourceSha']='e'*40
m.NODE_SHA=m.digest(b'node');m.BWRAP_SHA=m.digest(b'bwrap')
read_values={'owner-public.pem':b'OWNER_PUBLIC','node':b'node','bwrap':b'bwrap',
             'github-app.pem':b'EXISTING_APP_KEY'}
def read_file(p,**_):
 return read_values[Path(p).name]
calls=[];writes=[];current=[permit]
class StopAtClaim(Exception):pass
def write_file(path,data,mode=0o600):
 writes.append((str(path),data))
 if 'stage-claim-' in str(path):raise StopAtClaim()
def signed_file(name,public):
 assert name=='stage-approval.json' and public==b'OWNER_PUBLIC'
 if mode=='revoked-after-git' and calls:
  return dict(permit,actions=[])
 return permit
def call(cmd,**kw):
 calls.append(cmd)
 assert cmd==['/usr/bin/git','ls-remote',
 'https://github.com/ASI-integration/asi-landing.git','refs/heads/main'],cmd
 return (('e'*40 if mode=='different-main' else manifest['baseSha'])+
 '\\trefs/heads/main\\n').encode()
with patch.object(m,'prepared',return_value=(raw,manifest,files)),\
 patch.object(m.os,'geteuid',return_value=0),\
 patch.object(m.os,'uname',return_value=SimpleNamespace(nodename=m.HOST)),\
 patch.object(m,'regular_bytes',side_effect=read_file),\
 patch.object(m,'signed',side_effect=signed_file),\
 patch.object(m,'inactive'),\
 patch.object(m.Path,'exists',return_value=False),\
 patch.object(m.pwd,'getpwnam',side_effect=KeyError),\
 patch.object(m.time,'time',return_value=0.6),\
 patch.object(m,'call',side_effect=call),\
 patch.object(m,'write_new',side_effect=write_file),\
 patch.object(m.Path,'mkdir',side_effect=AssertionError('unexpected mutation')), \
 patch.object(m.os,'chown',side_effect=AssertionError('unexpected mutation')):
 try:m.stage(Path('/fixture'),Path('/node'),Path('/bwrap'))
 except StopAtClaim:
  assert mode=='valid',mode
  assert len(writes)==1 and 'stage-claim-' in writes[0][0]
  assert len(calls)==1
 except m.Block as e:
  assert mode!='valid',(mode,str(e))
  assert not writes, 'rejected stage consumed claim'
  if mode=='different-main':assert str(e)=='PROTECTED_MAIN_NOT_EXACT_BASE'
  elif mode=='revoked-after-git':assert str(e)=='STAGE_GRANT_CHANGED'
  else:assert str(e)=='STAGE_ADMISSION'
 else:raise AssertionError('stage unexpectedly returned')
\`;
for(const mode of ['valid','wrong-action','expired','wrong-unit','wrong-source','different-main','revoked-after-git']){
  test('exact signed isolation-stage preclaim is fail-closed: '+mode,()=>assert.doesNotThrow(()=>run(stageFixture,mode)));
}
const checkStaged=String.raw\`
import importlib.util,sys,json,stat
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mode=sys.argv[2];raw=b'{}';u=b'unit';manifest={'unitSha256':m.digest(u)}
m.NODE_SHA=m.digest(b'node');m.BWRAP_SHA=m.digest(b'bwrap')
m.stage_receipt_path=lambda _:Path('/etc/asi-github-engine/staged.json')
receipt={'schema':'asi.beget-staged-isolation.v1','manifestSha256':m.digest(raw),
'unitSha256':manifest['unitSha256'],'nodeSha256':m.NODE_SHA,'bwrapSha256':m.BWRAP_SHA,'uid':1020}
stored={'staged.json':json.dumps(receipt).encode(),'owner-public.pem':b'public',
 'manifest.json':raw,'node':b'node','bwrap':b'bwrap',m.UNIT:u,'runtime.mjs':b'module'}
if mode=='altered-module':stored['runtime.mjs']=b'changed'
if mode=='altered-receipt':stored['staged.json']=b'{}'
identity=SimpleNamespace(pw_uid=1020,pw_gid=1020,pw_shell='/usr/sbin/nologin',pw_dir=str(m.STATE))
if mode=='wrong-user':identity.pw_uid=2020
status='LoadState=loaded\\nActiveState=inactive\\nMainPID=0\\nUnitFileState=disabled\\n'
if mode=='enabled':status=status.replace('disabled','enabled')
if mode=='running':status=status.replace('inactive','active').replace('MainPID=0','MainPID=999')
def read_file(p,**kw):return stored[Path(p).name]
def call(a,**kw):
 assert a[:3]==['/usr/bin/systemctl','show',m.UNIT]
 return status.encode()
with patch.object(m,'regular_bytes',side_effect=read_file),\
 patch.object(m.pwd,'getpwnam',return_value=identity),\
 patch.object(m.Path,'lstat',return_value=SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=1020,st_gid=1020)),\
 patch.object(m,'call',side_effect=call):
 try:m.staged_state(raw,manifest,{'scripts/runtime.mjs':b'module',m.UNIT:u},b'public')
 except (m.Block,KeyError) as e:
  assert mode!='valid',mode
 else:assert mode=='valid',mode
\`;
for(const mode of ['valid','enabled','running','wrong-user','altered-module','altered-receipt']){
  test('activation rechecks exact staged unit and bytes: '+mode,()=>assert.doesNotThrow(()=>run(checkStaged,mode)));
}
