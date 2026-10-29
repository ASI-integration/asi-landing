import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const installer=fileURLToPath(new URL('./beget-install.py',import.meta.url));
const run=(code,mode)=>execFileSync('/usr/bin/python3',
  ['-I','-S','-B','-c',code,installer,mode],
  {timeout:6500,encoding:'utf8',stdio:['ignore','pipe','pipe']});

const stageFixture=String.raw`
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
 '\trefs/heads/main\n').encode()
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
`;
for(const mode of ['valid','wrong-action','expired','wrong-unit','wrong-source','different-main','revoked-after-git']){
  test('exact signed isolation-stage preclaim is fail-closed: '+mode,()=>assert.doesNotThrow(()=>run(stageFixture,mode)));
}
const checkStaged=String.raw`
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
status='LoadState=loaded\nActiveState=inactive\nMainPID=0\nUnitFileState=disabled\nFragmentPath=/etc/systemd/system/asi-strigunov-agent.service\nDropInPaths=\nUser=asi-engine\nGroup=asi-engine\n'
if mode=='enabled':status=status.replace('disabled','enabled')
if mode=='running':status=status.replace('inactive','active').replace('MainPID=0','MainPID=999')
if mode=='dropin':status=status.replace('DropInPaths=','DropInPaths=/etc/systemd/system/asi-strigunov-agent.service.d/replaced.conf')
if mode=='wrong-fragment':status=status.replace('FragmentPath=/etc/systemd/system/','FragmentPath=/run/systemd/system/')
if mode=='wrong-effective-user':status=status.replace('User=asi-engine','User=root')
def read_file(p,**kw):return stored[Path(p).name]
def call(a,**kw):
 assert a[:3]==['/usr/bin/systemctl','show',m.UNIT]
 return status.encode()
def staged_lstat(p):
 p=Path(p)
 if p==m.STATE:
  return SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=1020,st_gid=1020)
 directory=p==m.RUNTIME or p==m.RUNTIME/'scripts'
 if directory:
  permissions=0o700 if mode=='runtime-0700' and p==m.RUNTIME else 0o755
  return SimpleNamespace(st_mode=stat.S_IFDIR|permissions,st_uid=0,st_gid=0)
 if p.name in ('node','bwrap','runtime.mjs','manifest.json'):
  permissions=(0o755 if p.name in ('node','bwrap') else 0o644)
  if mode=='module-0600' and p.name=='runtime.mjs':permissions=0o600
  if mode=='node-0700' and p.name=='node':permissions=0o700
  return SimpleNamespace(st_mode=stat.S_IFREG|permissions,st_uid=0,st_gid=0,st_nlink=1)
 raise AssertionError('unexpected staged path '+str(p))
with patch.object(m,'regular_bytes',side_effect=read_file),\
 patch.object(m.pwd,'getpwnam',return_value=identity),\
 patch.object(m.Path,'lstat',side_effect=staged_lstat),\
 patch.object(m,'call',side_effect=call):
 try:m.staged_state(raw,manifest,{'scripts/runtime.mjs':b'module',m.UNIT:u},b'public')
 except (m.Block,KeyError) as e:
  assert mode!='valid',mode
 else:assert mode=='valid',mode
`;
for(const mode of ['valid','enabled','running','wrong-user','altered-module','altered-receipt','dropin','wrong-fragment','wrong-effective-user','runtime-0700','module-0600','node-0700']){
  test('activation rechecks exact staged unit and bytes: '+mode,()=>assert.doesNotThrow(()=>run(checkStaged,mode)));
}


const fullStage=String.raw`
import importlib.util,sys,json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
s=importlib.util.spec_from_file_location('installer',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
raw=b'{"stage":true}'
m.NODE_SHA=m.digest(b'node')
m.BWRAP_SHA=m.digest(b'bwrap')
files={m.UNIT:b'[Unit]\nDescription=fixture\n',
       'scripts/strigunov4/execution-adapters/host-runtime.mjs':b'export {}'}
manifest={'sourceSha':'a'*40,'baseSha':'b'*40,'unitSha256':m.digest(files[m.UNIT])}
grant=dict(schema=m.STAGE_SCHEMA,host=m.HOST,unit=m.UNIT,
           manifestSha256=m.digest(raw),sourceSha=manifest['sourceSha'],
           baseSha=manifest['baseSha'],unitSha256=manifest['unitSha256'],
           actions=m.STAGE_ACTIONS,notBefore=100,expiresAt=5000)
commands=[];writes=[];lookups=[0]
def checkuser(name):
 lookups[0]+=1
 if lookups[0]==1:raise KeyError()
 return SimpleNamespace(pw_uid=1020,pw_gid=1020)
def call(argv,**kwargs):
 commands.append(argv)
 if argv[:2]==['/usr/bin/git','ls-remote']:
  return (manifest['baseSha']+'\trefs/heads/main\n').encode()
 if argv[:3]==['/usr/bin/systemctl','show',m.UNIT]:
  return b'LoadState=loaded\nActiveState=inactive\nMainPID=0\nUnitFileState=disabled\nFragmentPath=/etc/systemd/system/asi-strigunov-agent.service\nDropInPaths=\nUser=asi-engine\nGroup=asi-engine\n'
 return b''
def read(p,**kw):
 return {'owner-public.pem':b'public','node':b'node','bwrap':b'bwrap',
         'github-app.pem':b'valid-old-app-credential'}[Path(p).name]
def write(p,b,mode=0o600):writes.append((str(p),mode))
with patch.object(m,'prepared',return_value=(raw,manifest,files)),\
 patch.object(m.os,'geteuid',return_value=0),\
 patch.object(m.os,'uname',return_value=SimpleNamespace(nodename=m.HOST)),\
 patch.object(m,'regular_bytes',side_effect=read),\
 patch.object(m,'signed',return_value=grant),\
 patch.object(m,'inactive'),\
 patch.object(m.Path,'exists',return_value=False),\
 patch.object(m.pwd,'getpwnam',side_effect=checkuser),\
 patch.object(m.time,'time',return_value=0.6),\
 patch.object(m,'call',side_effect=call),\
 patch.object(m,'write_new',side_effect=write),\
 patch.object(m,'normalize_new_runtime_modes'),\
 patch.object(m.Path,'mkdir'),patch.object(m.os,'chown'):
 m.stage(Path('/fixture'),Path('/node'),Path('/bwrap'))
assert len(writes)==7,writes # claim, module, manifest, node, bwrap, unit, receipt
assert 'stage-claim-' in writes[0][0] and 'staged-isolation-' in writes[-1][0]
assert any(cmd[0]=='/usr/sbin/useradd' for cmd in commands)
assert any(cmd[:2]==['/usr/bin/systemctl','daemon-reload'] for cmd in commands)
assert not any('enable' in cmd or 'start' in cmd or '--now' in cmd for cmd in commands),commands
assert all('github-app.pem' not in w[0] for w in writes)
`;
test('successful staged install only provisions a disabled unit; no start/enable/key grant',()=>{
  assert.match(run(fullStage,'valid'),/STAGED_ISOLATION_PENDING/);
});


// Real mode regression: staging under a 0077 umask must produce traversable
// root-owned runtime bytes for the *different* service UID, but never open
// authority/state paths. Uses only isolated temporary fixture files.
const runtimeModeFixture=String.raw\`
import importlib.util,os,sys,stat,tempfile
from pathlib import Path
s=importlib.util.spec_from_file_location('installer',sys.argv[1])
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
mode=sys.argv[2]
files={'scripts/strigunov4/execution-adapters/runtime.mjs':b'export const fixture=true'}
with tempfile.TemporaryDirectory(prefix='asi-engine-umask-') as root:
 m.RUNTIME=Path(root)/'runtime'
 old=os.umask(0o077)
 try:
  m.RUNTIME.mkdir(mode=0o755)
  for rel,body in files.items():m.write_new(m.RUNTIME/rel,body,0o644)
  m.write_new(m.RUNTIME/'manifest.json',b'{}',0o644)
  m.write_new(m.RUNTIME/'node',b'node-fixture',0o755)
  m.write_new(m.RUNTIME/'bwrap',b'bwrap-fixture',0o755)
 finally:os.umask(old)
 assert stat.S_IMODE(m.RUNTIME.stat().st_mode)==0o700
 assert stat.S_IMODE((m.RUNTIME/'node').stat().st_mode)==0o700
 m.normalize_new_runtime_modes(files)
 m.runtime_service_access(files,os.geteuid())
 dirs,targets=m.runtime_targets(files)
 assert all(stat.S_IMODE(d.stat().st_mode)==0o755 for d in dirs)
 assert all(stat.S_IMODE(p.stat().st_mode)==access for p,access in targets)
 p={'runtime-0700':m.RUNTIME,
    'module-0600':m.RUNTIME/'scripts/strigunov4/execution-adapters/runtime.mjs',
    'node-0700':m.RUNTIME/'node',
    'bwrap-0700':m.RUNTIME/'bwrap',
    'script-dir-0700':m.RUNTIME/'scripts',
    'world-writable-module':m.RUNTIME/'scripts/strigunov4/execution-adapters/runtime.mjs'
   }.get(mode)
 if p is not None:
  p.chmod(0o666 if mode=='world-writable-module' else 0o700 if '0700' in mode else 0o600)
  try:m.runtime_service_access(files,os.geteuid())
  except m.Block as e:assert str(e) in ('STAGED_RUNTIME_UNREADABLE','STAGED_RUNTIME_PATH')
  else:raise AssertionError('inaccessible staged bytes accepted: '+mode)
 elif mode=='symlink-module':
  p=m.RUNTIME/'scripts/strigunov4/execution-adapters/runtime.mjs'
  p.unlink();p.symlink_to(m.RUNTIME/'manifest.json')
  try:m.runtime_service_access(files,os.geteuid())
  except m.Block as e:assert str(e)=='STAGED_RUNTIME_PATH'
  else:raise AssertionError('symlink accepted')
 else:assert mode=='valid'
\`;
for(const mode of ['valid','runtime-0700','module-0600','node-0700','bwrap-0700','script-dir-0700','world-writable-module','symlink-module']){
  test('restrictive umask / staged runtime access: '+mode,()=>assert.doesNotThrow(()=>run(runtimeModeFixture,mode)));
}
