"""Protected Beget candidate installer. No execution on import. No state migration.
--plan is read-only. --apply needs a fresh exact-manifest signed root admission.
Failure preserves the consumed claim, runtime, state and every receipt.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import tempfile
import time

HOST='pqukibofpo'
UNIT='asi-strigunov-agent.service'
RUNTIME=Path('/opt/asi-engine')
STATE=Path('/var/lib/asi-engine')
AUTH=Path('/etc/asi-github-engine')
USER='asi-engine'
ACTIONS=['create-service-account','install-exact-runtime','grant-read-only-authority',
         'initialize-clean-state','install-unit','daemon-reload','enable-start-engine',
         'stop-disable-engine-on-failure']
NODE_SHA='8142d37c6f2f372ef040419e7a111a6baf17df89f8078d02447d6c639ae20c1d'
BWRAP_SHA='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
class Block(Exception): pass
def require(ok,code):
    if not ok: raise Block(code)
def digest(raw): return hashlib.sha256(raw).hexdigest()
def call(args, **kw):
    return subprocess.run(args,check=True,capture_output=True,timeout=120,
        env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'},**kw).stdout

def regular_bytes(p, root=False, limit=2000000):
    p=Path(p);require(p.is_absolute() and p.resolve()==p,'PATH')
    if root:
        for parent in p.parents:
            st=parent.lstat();require(st.st_uid==0 and not st.st_mode&0o022,'ROOT_PARENT')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        st=os.fstat(fd);require(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_size<=limit,'FILE')
        if root: require(st.st_uid==0 and not st.st_mode&0o022,'ROOT_FILE')
        raw=b''
        while len(raw)<=limit:
            piece=os.read(fd,min(65536,limit+1-len(raw)))
            if not piece:break
            raw+=piece
        after=os.fstat(fd)
        fields=('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns')
        require(len(raw)==st.st_size and all(getattr(after,k)==getattr(st,k) for k in fields),'FILE_CHANGED')
        return raw
    finally:os.close(fd)

def signed(name, public):
    envelope=json.loads(regular_bytes(AUTH/name,root=True))
    raw=envelope['payload'].encode('utf8');signature=base64.b64decode(envelope['signature'],validate=True)
    require(len(signature)==64 and len(raw)<800000,'SIGNATURE_SCHEMA')
    with tempfile.TemporaryDirectory(prefix='asi-public-verification-') as d:
        for n,data in [('public.pem',public),('payload',raw),('signature',signature)]:
            Path(d,n).write_bytes(data)
        call(['/usr/bin/openssl','pkeyutl','-verify','-pubin','-inkey',d+'/public.pem',
              '-rawin','-in',d+'/payload','-sigfile',d+'/signature'])
    return json.loads(raw)

def prepared(package):
    raw=regular_bytes(package/'manifest.json');m=json.loads(raw)
    require(m['schema']=='asi.beget-engine-source.v1' and len(m['files'])<=100,'MANIFEST')
    files={}
    for row in m['files']:
        rel=row['path'];require(rel.startswith('scripts/') and rel.endswith('.mjs') and
            all(p not in ('','..','.') for p in rel.split('/')) and rel not in files,'MANIFEST_PATH')
        content=regular_bytes(package/rel);require(digest(content)==row['sha256'],'SOURCE_HASH');files[rel]=content
    for name,field in [('catalog.json','catalogSha256'),(UNIT,'unitSha256'),('beget-install.py','installerSha256')]:
        content=regular_bytes(package/name);require(digest(content)==m[field],'ARTIFACT_HASH');files[name]=content
    require(files['beget-install.py']==regular_bytes(Path(__file__).resolve()),'INSTALLER_IDENTITY')
    return raw,m,files

def write_new(p,data,mode=0o600):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        with os.fdopen(fd,'wb',closefd=False) as stream:
            stream.write(data);stream.flush();os.fsync(fd)
    finally:os.close(fd)
    fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def inactive():
    status=call(['/usr/bin/systemctl','show',UNIT,'-pLoadState','-pActiveState','-pMainPID']).decode()
    require('LoadState=not-found' in status and 'MainPID=0' in status,'EXISTING_ENGINE_REQUIRES_REVIEW')

def activation_preclaim(activation, now):
    require(activation.get('host')==HOST and activation.get('service')==UNIT and
        type(activation.get('notBefore')) is int and type(activation.get('expiresAt')) is int and
        activation['notBefore']<=now<activation['expiresAt'] and
        activation['expiresAt']-activation['notBefore']<=14*86400000,'ACTIVATION_WINDOW_OR_HOST')

def authority_traversal():
    # The account does not exist yet. Require traversal for a new, unrelated UID,
    # without changing directory permissions or granting directory listing/write.
    for p in (AUTH, *AUTH.parents):
        st=p.lstat()
        require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and
            not st.st_mode&0o022 and st.st_mode&0o001,'AUTHORITY_NOT_TRAVERSABLE')

def apply(package,node,bwrap):
    raw,m,files=prepared(package)
    require(os.geteuid()==0 and os.uname().nodename==HOST,'PROTECTED_HOST_REQUIRED')
    public=regular_bytes(AUTH/'owner-public.pem',root=True)
    permit=signed('install-approval.json',public)
    now=int(time.time()*1000)
    require(permit.get('schema')=='asi.beget-install-authorization.v1' and permit.get('host')==HOST and
        permit.get('unit')==UNIT and permit.get('manifestSha256')==digest(raw) and
        permit.get('actions')==ACTIONS and type(permit.get('notBefore')) is int and
        type(permit.get('expiresAt')) is int and permit['notBefore']<=now<permit['expiresAt'] and
        permit['expiresAt']-permit['notBefore']<=14*86400000,'INSTALL_ADMISSION')
    # These are SHA-bound protected review artifacts, not flags supplied on CLI.
    for name,field in [('fence.json','fenceSha256'),('native-isolation.json','nativeIsolationSha256'),
                       ('source-review.json','sourceReviewSha256'),('activation.json','activationSha256')]:
        expected=permit.get(field);require(type(expected) is str and len(expected)==64,'EVIDENCE_PIN')
        require(digest(regular_bytes(AUTH/name,root=True))==expected,'PROTECTED_EVIDENCE_CHANGED')
    native=json.loads(regular_bytes(AUTH/'native-isolation.json',root=True))
    require(native.get('host')==HOST and native.get('unitSha256')==m['unitSha256'] and
        native.get('bwrapSha256')==BWRAP_SHA and native.get('result')=='PASS' and
        native.get('networkDenied') is True and native.get('authorityInaccessible') is True,'NATIVE_SANDBOX_NOT_PROVEN')
    review=json.loads(regular_bytes(AUTH/'source-review.json',root=True))
    require(review.get('sourceSha')==m['sourceSha'] and review.get('result')=='PASS' and
        review.get('independent') is True and review.get('findings')==0,'SOURCE_REVIEW_NOT_PROVEN')
    activation=signed('activation.json',public)
    activation_preclaim(activation, now)
    authority_traversal()
    require(activation.get('runtimeManifestSha256')==digest(raw) and activation.get('catalogSha256')==m['catalogSha256'] and
        activation.get('baseSha')==m['baseSha'],'ACTIVATION_MANIFEST')
    require(regular_bytes(AUTH/'catalog.json',root=True)==files['catalog.json'],'CATALOG_BYTES')
    nodebytes=regular_bytes(node,limit=150000000);bwrapbytes=regular_bytes(bwrap)
    require(digest(nodebytes)==NODE_SHA and digest(bwrapbytes)==BWRAP_SHA,'DEPENDENCY_HASH')
    inactive()
    require(not RUNTIME.exists() and not STATE.exists() and not Path('/etc/systemd/system',UNIT).exists(),'CLEAN_INSTALL_REQUIRED')
    try:pwd.getpwnam(USER);raise Block('SERVICE_IDENTITY_EXISTS')
    except KeyError:pass
    main=call(['/usr/bin/git','ls-remote','https://github.com/ASI-integration/asi-landing.git','refs/heads/main']).decode().split()
    require(main==[m['baseSha'],'refs/heads/main'],'PROTECTED_MAIN_NOT_EXACT_BASE')
    claim=AUTH/('install-claim-'+digest(raw)+'.json')
    write_new(claim,json.dumps({'manifestSha256':digest(raw),'at':now,'oneUse':True}).encode())
    installed_unit=False
    try:
        call(['/usr/sbin/useradd','--system','--user-group','--home-dir',str(STATE),'--no-create-home','--shell','/usr/sbin/nologin',USER])
        identity=pwd.getpwnam(USER)
        RUNTIME.mkdir(mode=0o755)
        for rel,data in files.items():
            if rel.startswith('scripts/'):write_new(RUNTIME/rel,data,0o644)
        write_new(RUNTIME/'manifest.json',raw,0o644)
        write_new(RUNTIME/'node',nodebytes,0o755);write_new(RUNTIME/'bwrap',bwrapbytes,0o755)
        STATE.mkdir(mode=0o700);os.chown(STATE,identity.pw_uid,identity.pw_gid)
        for name in ('owner-public.pem','activation.json','catalog.json','fence.json','reviews.json','github-app.pem'):
            p=AUTH/name;regular_bytes(p,root=True);os.chown(p,0,identity.pw_gid);os.chmod(p,0o640)
        code="""import fs from 'node:fs/promises';import {loadBegetAuthority,BEGET} from '/opt/asi-engine/scripts/strigunov4/execution-adapters/host-authority.mjs';import {initializeState,atomicJson,digest} from '/opt/asi-engine/scripts/strigunov4/execution-adapters/state.mjs';import {initializeRoutingState} from '/opt/asi-engine/scripts/global-dispatcher/dispatcher.mjs';const a=await loadBegetAuthority();await a.fencingWitness();await initializeState(BEGET.root,{liveAdmission:a.admission});await fs.mkdir(BEGET.root+'/routing',{mode:0o700});await initializeRoutingState(BEGET.root+'/routing');await atomicJson(BEGET.root+'/state/api-budget.json',{policySha256:digest(JSON.stringify(a.payload)),requests:0,mutations:0});"""
        call(['/usr/sbin/runuser','-u',USER,'--',str(RUNTIME/'node'),'--input-type=module','-e',code])
        for task in json.loads(files['catalog.json']):
            dest=str(STATE/'scratchpads'/task['id'])
            call(['/usr/sbin/runuser','-u',USER,'--','/usr/bin/git','-c','core.hooksPath=/dev/null','clone','--no-checkout','--no-hardlinks','https://github.com/ASI-integration/asi-landing.git',dest])
            call(['/usr/sbin/runuser','-u',USER,'--','/usr/bin/git','-C',dest,'-c','core.hooksPath=/dev/null','checkout','--detach',m['baseSha']])
            os.chmod(dest,0o700)
        write_new(Path('/etc/systemd/system')/UNIT,files[UNIT],0o644);installed_unit=True
        call(['/usr/bin/systemd-analyze','verify',str(Path('/etc/systemd/system')/UNIT)])
        call(['/usr/bin/systemctl','daemon-reload']);call(['/usr/bin/systemctl','enable','--now',UNIT])
        print(json.dumps({'status':'INSTALLED_ACCEPTANCE_PENDING','manifestSha256':digest(raw)}))
    except Exception:
        if installed_unit:
            try:
                call(['/usr/bin/systemctl','disable','--now',UNIT])
                require(call(['/usr/bin/systemctl','show',UNIT,'-pMainPID','--value']).strip()==b'0','STOP_UNCONFIRMED')
            except Exception:raise Block('STOP_UNCONFIRMED')
        raise Block('SAFE_STOP_PRESERVED_NO_REAPPLY')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--package',type=Path,required=True)
    parser.add_argument('--apply',action='store_true');parser.add_argument('--node',type=Path);parser.add_argument('--bwrap',type=Path)
    args=parser.parse_args();package=args.package.resolve()
    if args.apply:
        require(args.node is not None and args.bwrap is not None,'DEPENDENCIES_REQUIRED');apply(package,args.node.resolve(),args.bwrap.resolve())
    else:
        raw,m,_=prepared(package)
        print(json.dumps({'status':'CANDIDATE_ONLY','manifestSha256':digest(raw),'host':HOST,'unit':UNIT,'actions':ACTIONS,
            'paths':[str(RUNTIME),str(STATE),str(AUTH),'/etc/systemd/system/'+UNIT],
            'installable':False,'requiredGates':m['requiredGates']}))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'status':'BLOCKED','reason':str(e) if type(e) is Block else 'INSTALL_RESULT_UNKNOWN'}));raise SystemExit(2)
