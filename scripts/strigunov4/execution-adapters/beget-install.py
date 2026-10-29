"""Protected Beget candidate installer. No execution on import. No state migration.
--plan is read-only. --apply needs a fresh exact-manifest signed root admission.
Failure preserves the consumed claim, runtime, state and every receipt.
"""
import argparse
import base64
import hashlib
import json
import math
import os
import re
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.request

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
# Staging is a separately signed, ONE-USE permission. It never starts the Engine.
# The original installation approval is required again at the second phase.
STAGE_ACTIONS=['create-isolated-service-account','install-exact-runtime-without-authority',
               'install-disabled-unit','native-isolation-acceptance-only']
STAGE_SCHEMA='asi.beget-isolation-stage-authorization.v1'
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

def fence_preclaim(f, activation):
    # Match loadBegetAuthority().fencingWitness before any install mutation.
    # This validates the admitted record, not the remote provider evidence itself.
    def safe_integer(v):
        return type(v) in (int, float) and abs(v)<=9007199254740991 and math.isfinite(v) and int(v)==v
    require(type(f) is dict and type(activation.get('githubApp')) is dict,'OLD_WRITER_FENCING_UNVERIFIED')
    new=activation['githubApp'].get('installationId')
    old=f.get('oldInstallationId');expiry=f.get('outstandingTokensExpiredAt');evidence=f.get('independentEvidenceSha256')
    require(f.get('schema')=='asi.old-writer-fence.v1' and activation.get('repo')=='ASI-integration/asi-landing' and
        f.get('repository')==activation['repo'] and safe_integer(new) and new>0 and
        f.get('method')=='REVOKED_OLD_GITHUB_INSTALLATION' and safe_integer(old) and old>0 and
        old!=new and f.get('oldCredentialsRevoked') is True and
        safe_integer(expiry) and expiry<=activation['notBefore'] and
        type(evidence) is str and re.fullmatch('[a-f0-9]{64}',evidence) is not None and
        f.get('verifiedBy')=='protected-install-review' and type(f.get('deniedPullRequests')) is list and
        531 in f['deniedPullRequests'],'OLD_WRITER_FENCING_UNVERIFIED')

# Single-owner bootstrap is deliberately distinct from an independent-human review.
# Re-read GitHub CI using HTTPS; owner-supplied run IDs or JSON flags are not evidence.
def verified_owner_ci_run(run_id, workflow_id, sha, event):
    require(type(run_id) is int and run_id>0,'OWNER_CI_RUN_ID')
    url='https://api.github.com/repos/ASI-integration/asi-landing/actions/runs/'+str(run_id)
    req=urllib.request.Request(url,headers={
        'Accept':'application/vnd.github+json',
        'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'asi-beget-exact-release-verifier'})
    try:
        with urllib.request.urlopen(req,timeout=12) as response:
            require(response.status==200,'OWNER_CI_PROVIDER_UNVERIFIED')
            raw=response.read(200001)
        require(len(raw)<=200000,'OWNER_CI_PROVIDER_UNVERIFIED')
        run=json.loads(raw)
    except Exception:
        raise Block('OWNER_CI_PROVIDER_UNVERIFIED')
    require(type(run) is dict and run.get('id')==run_id and
            run.get('workflow_id')==workflow_id and
            run.get('event')==event and run.get('head_sha')==sha and
            run.get('status')=='completed' and run.get('conclusion')=='success' and
            type(run.get('repository')) is dict and
            run['repository'].get('full_name')=='ASI-integration/asi-landing',
            'OWNER_CI_EXACT_HEAD_FAILED')

def source_review_preclaim(review,manifest):
    require(type(review) is dict and review.get('sourceSha')==manifest['sourceSha'] and
            review.get('result')=='PASS' and
            type(review.get('findings')) is int and review['findings']==0,
            'SOURCE_REVIEW_NOT_PROVEN')
    if review.get('mode')=='OWNER_VERIFIED_CI':
        require(type(review.get('ownerId')) is int and review['ownerId']==207600140 and
                review.get('scope')=='BEGET_G2_TWO_DRAFT_WITNESSES' and
                review.get('independent') is False and
                type(review.get('validationRunId')) is int and
                type(review.get('governanceRunId')) is int and
                review.get('validationRunId')!=review.get('governanceRunId'),
                'OWNER_CI_SCOPE')
        verified_owner_ci_run(review['validationRunId'],311380800,manifest['sourceSha'],'pull_request')
        verified_owner_ci_run(review['governanceRunId'],390653294,manifest['sourceSha'],'pull_request_target')
    else:
        require(review.get('independent') is True and review.get('mode') in (None,'INDEPENDENT_HUMAN'),
                'SOURCE_REVIEW_NOT_PROVEN')


def stage_scope(permit,manifest,raw,now):
    require(type(permit) is dict and permit.get('schema')==STAGE_SCHEMA and
        permit.get('host')==HOST and permit.get('unit')==UNIT and
        permit.get('manifestSha256')==digest(raw) and
        permit.get('sourceSha')==manifest['sourceSha'] and
        permit.get('baseSha')==manifest['baseSha'] and
        permit.get('unitSha256')==manifest['unitSha256'] and
        permit.get('actions')==STAGE_ACTIONS and
        type(permit.get('notBefore')) is int and type(permit.get('expiresAt')) is int and
        permit['notBefore']<=now<permit['expiresAt'] and
        permit['expiresAt']-permit['notBefore']<=14*86400000,
        'STAGE_ADMISSION')

def stage_receipt_path(raw):
    return AUTH/('staged-isolation-'+digest(raw)+'.json')

def staged_state(raw,manifest,files,public):
    # Enforce *exact* staged bytes, without trusting a root-owned JSON claim alone.
    receipt=json.loads(regular_bytes(stage_receipt_path(raw),root=True))
    require(type(receipt) is dict and receipt.get('schema')=='asi.beget-staged-isolation.v1' and
        receipt.get('manifestSha256')==digest(raw) and
        receipt.get('unitSha256')==manifest['unitSha256'] and
        receipt.get('nodeSha256')==NODE_SHA and receipt.get('bwrapSha256')==BWRAP_SHA and
        type(receipt.get('uid')) is int and receipt['uid']>0,
        'STAGE_RECEIPT_UNVERIFIED')
    identity=pwd.getpwnam(USER)
    require(identity.pw_uid>0 and identity.pw_gid>0 and identity.pw_shell=='/usr/sbin/nologin' and
        identity.pw_dir==str(STATE) and identity.pw_uid==receipt['uid'],'STAGED_IDENTITY_CHANGED')
    require(regular_bytes(AUTH/'owner-public.pem',root=True)==public,'STAGED_OWNER_KEY_CHANGED')
    for rel,data in files.items():
        if rel.startswith('scripts/'):
            require(regular_bytes(RUNTIME/rel,root=True)==data,'STAGED_SOURCE_CHANGED')
    require(regular_bytes(RUNTIME/'manifest.json',root=True)==raw and
        digest(regular_bytes(RUNTIME/'node',root=True,limit=150000000))==NODE_SHA and
        digest(regular_bytes(RUNTIME/'bwrap',root=True))==BWRAP_SHA and
        regular_bytes(Path('/etc/systemd/system')/UNIT,root=True)==files[UNIT],
        'STAGED_DEPENDENCY_CHANGED')
    st=STATE.lstat()
    require(stat.S_ISDIR(st.st_mode) and st.st_uid==identity.pw_uid and
        st.st_gid==identity.pw_gid and not st.st_mode&0o077,'STAGED_STATE_CHANGED')
    status=call(['/usr/bin/systemctl','show',UNIT,
                 '-pLoadState','-pActiveState','-pMainPID','-pUnitFileState']).decode().splitlines()
    require('LoadState=loaded' in status and 'ActiveState=inactive' in status and
        'MainPID=0' in status and 'UnitFileState=disabled' in status,
        'STAGED_UNIT_NOT_DISABLED')
    return identity

def stage(package,node,bwrap):
    # Fail closed before any mutation; the staged unit is never enabled or started.
    raw,manifest,files=prepared(package)
    require(os.geteuid()==0 and os.uname().nodename==HOST,'PROTECTED_HOST_REQUIRED')
    public=regular_bytes(AUTH/'owner-public.pem',root=True)
    permit=signed('stage-approval.json',public)
    stage_scope(permit,manifest,raw,int(time.time()*1000))
    nodebytes=regular_bytes(node,limit=150000000)
    bwrapbytes=regular_bytes(bwrap)
    require(digest(nodebytes)==NODE_SHA and digest(bwrapbytes)==BWRAP_SHA,
            'DEPENDENCY_HASH')
    inactive()
    require(not RUNTIME.exists() and not STATE.exists() and
        not Path('/etc/systemd/system',UNIT).exists() and
        not stage_receipt_path(raw).exists(),'STAGE_NOT_CLEAN')
    try:pwd.getpwnam(USER);raise Block('SERVICE_IDENTITY_EXISTS')
    except KeyError:pass
    # No activation material may be present; the service cannot publish.
    require(all(not (AUTH/name).exists() for name in
        ('activation.json','catalog.json','reviews.json','install-approval.json')),
        'STAGE_LIVE_AUTHORITY_PRESENT')
    require(regular_bytes(AUTH/'github-app.pem',root=True,limit=20000)!=b'',
            'STAGE_APP_KEY_MISSING')
    main=call(['/usr/bin/git','ls-remote',
               'https://github.com/ASI-integration/asi-landing.git','refs/heads/main']).decode().split()
    require(main==[manifest['baseSha'],'refs/heads/main'],
            'PROTECTED_MAIN_NOT_EXACT_BASE')
    stage_scope(permit,manifest,raw,int(time.time()*1000))
    require(all(not (AUTH/name).exists() for name in
        ('activation.json','catalog.json','reviews.json','install-approval.json')),
        'STAGE_LIVE_AUTHORITY_PRESENT')
    require(not RUNTIME.exists() and not STATE.exists() and
        not Path('/etc/systemd/system',UNIT).exists(),'STAGE_NOT_CLEAN')
    require(regular_bytes(AUTH/'owner-public.pem',root=True)==public and
        signed('stage-approval.json',public)==permit,'STAGE_GRANT_CHANGED')
    claim=AUTH/('stage-claim-'+digest(raw)+'.json')
    write_new(claim,json.dumps({'manifestSha256':digest(raw),'oneUse':True}).encode())
    installed_unit=False
    try:
        call(['/usr/sbin/useradd','--system','--user-group','--home-dir',str(STATE),
              '--no-create-home','--shell','/usr/sbin/nologin',USER])
        identity=pwd.getpwnam(USER)
        RUNTIME.mkdir(mode=0o755)
        for rel,data in files.items():
            if rel.startswith('scripts/'):write_new(RUNTIME/rel,data,0o644)
        write_new(RUNTIME/'manifest.json',raw,0o644)
        write_new(RUNTIME/'node',nodebytes,0o755)
        write_new(RUNTIME/'bwrap',bwrapbytes,0o755)
        STATE.mkdir(mode=0o700)
        os.chown(STATE,identity.pw_uid,identity.pw_gid)
        write_new(Path('/etc/systemd/system')/UNIT,files[UNIT],0o644)
        installed_unit=True
        call(['/usr/bin/systemd-analyze','verify',str(Path('/etc/systemd/system')/UNIT)])
        call(['/usr/bin/systemctl','daemon-reload'])
        # A new unit is disabled by default; assert rather than trying to
        # reset the status of any pre-existing service.
        status=call(['/usr/bin/systemctl','show',UNIT,
                     '-pLoadState','-pActiveState','-pMainPID','-pUnitFileState']).decode().splitlines()
        require('LoadState=loaded' in status and 'ActiveState=inactive' in status and
                'MainPID=0' in status and 'UnitFileState=disabled' in status,
                'STAGED_UNIT_NOT_DISABLED')
        receipt={'schema':'asi.beget-staged-isolation.v1',
                 'manifestSha256':digest(raw),
                 'unitSha256':manifest['unitSha256'],
                 'nodeSha256':NODE_SHA,'bwrapSha256':BWRAP_SHA,
                 'uid':identity.pw_uid}
        write_new(stage_receipt_path(raw),json.dumps(receipt,sort_keys=True).encode())
        print(json.dumps({'status':'STAGED_ISOLATION_PENDING',
                          'manifestSha256':digest(raw),'unit':UNIT,
                          'serviceEnabled':False,'serviceStarted':False}))
    except Exception:
        if installed_unit:
            try:
                call(['/usr/bin/systemctl','disable','--now',UNIT])
                require(call(['/usr/bin/systemctl','show',UNIT,'-pMainPID','--value']).strip()==b'0',
                        'STOP_UNCONFIRMED')
            except Exception:raise Block('STOP_UNCONFIRMED')
        raise Block('STAGE_FAILED_SAFE_STOP_RETAINED')

def apply(package,node,bwrap,staged=False):
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
    source_review_preclaim(review,m)
    activation=signed('activation.json',public)
    activation_preclaim(activation, now)
    authority_traversal()
    require(activation.get('runtimeManifestSha256')==digest(raw) and activation.get('catalogSha256')==m['catalogSha256'] and
        activation.get('baseSha')==m['baseSha'],'ACTIVATION_MANIFEST')
    require(regular_bytes(AUTH/'catalog.json',root=True)==files['catalog.json'],'CATALOG_BYTES')
    nodebytes=regular_bytes(node,limit=150000000);bwrapbytes=regular_bytes(bwrap)
    require(digest(nodebytes)==NODE_SHA and digest(bwrapbytes)==BWRAP_SHA,'DEPENDENCY_HASH')
    if staged:
        staged_state(raw,m,files,public)
        # Stage and activation are never the same owner signature.
        # A root-owned stage receipt is insufficient without the owner's
        # original, still-verifiable and exact-bound signed stage grant.
        stage_grant=signed('stage-approval.json',public)
        stage_scope(stage_grant,m,raw,int(time.time()*1000))
    else:
        inactive()
        require(not RUNTIME.exists() and not STATE.exists() and
                not Path('/etc/systemd/system',UNIT).exists(),'CLEAN_INSTALL_REQUIRED')
        try:pwd.getpwnam(USER);raise Block('SERVICE_IDENTITY_EXISTS')
        except KeyError:pass
    main=call(['/usr/bin/git','ls-remote','https://github.com/ASI-integration/asi-landing.git','refs/heads/main']).decode().split()
    require(main==[m['baseSha'],'refs/heads/main'],'PROTECTED_MAIN_NOT_EXACT_BASE')
    claim=AUTH/('install-claim-'+digest(raw)+'.json')
    # Slow external verification may consume the remaining authorization window.
    # Recheck both signed grants at the irreversible one-use claim boundary.
    now=int(time.time()*1000)
    require(permit['notBefore']<=now<permit['expiresAt'],'INSTALL_ADMISSION')
    activation_preclaim(activation, now)
    # Slow provider verification may span a root-owned grant or evidence
    # replacement. Recheck every protected input before the one-use claim.
    require(regular_bytes(AUTH/'owner-public.pem',root=True)==public,'OWNER_KEY_CHANGED_BEFORE_CLAIM')
    require(signed('install-approval.json',public)==permit and
            signed('activation.json',public)==activation,'PROTECTED_GRANT_CHANGED')
    for name,field in [('native-isolation.json','nativeIsolationSha256'),
                       ('source-review.json','sourceReviewSha256'),('activation.json','activationSha256')]:
        require(digest(regular_bytes(AUTH/name,root=True))==permit[field],'PROTECTED_EVIDENCE_CHANGED')
    require(regular_bytes(AUTH/'catalog.json',root=True)==files['catalog.json'],'CATALOG_BYTES')
    fence=regular_bytes(AUTH/'fence.json',root=True)
    require(digest(fence)==permit['fenceSha256']==activation.get('fenceSha256'),'PROTECTED_EVIDENCE_CHANGED')
    def reject_constant(_):raise ValueError()
    try:fence_record=json.loads(fence.decode('utf8'),parse_constant=reject_constant)
    except (ValueError, UnicodeError):raise Block('OLD_WRITER_FENCING_UNVERIFIED')
    fence_preclaim(fence_record, activation)
    if staged:
        # Native isolation evidence and the staged unit may change while the
        # external GitHub main check is running; recheck before consuming claim.
        staged_state(raw,m,files,public)
        stage_scope(signed('stage-approval.json',public),m,raw,now)
    write_new(claim,json.dumps({'manifestSha256':digest(raw),'at':now,'oneUse':True}).encode())
    installed_unit=staged
    try:
        if not staged:
            call(['/usr/sbin/useradd','--system','--user-group','--home-dir',str(STATE),
                  '--no-create-home','--shell','/usr/sbin/nologin',USER])
        identity=pwd.getpwnam(USER)
        if not staged:
            RUNTIME.mkdir(mode=0o755)
            for rel,data in files.items():
                if rel.startswith('scripts/'):write_new(RUNTIME/rel,data,0o644)
            write_new(RUNTIME/'manifest.json',raw,0o644)
            write_new(RUNTIME/'node',nodebytes,0o755)
            write_new(RUNTIME/'bwrap',bwrapbytes,0o755)
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
        if not staged:
            write_new(Path('/etc/systemd/system')/UNIT,files[UNIT],0o644)
            installed_unit=True
        call(['/usr/bin/systemd-analyze','verify',str(Path('/etc/systemd/system')/UNIT)])
        call(['/usr/bin/systemctl','daemon-reload'])
        call(['/usr/bin/systemctl','enable','--now',UNIT])
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
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--stage',action='store_true')
    modes.add_argument('--activate-stage',action='store_true')
    modes.add_argument('--apply',action='store_true')
    parser.add_argument('--node',type=Path);parser.add_argument('--bwrap',type=Path)
    args=parser.parse_args();package=args.package.resolve()
    if args.apply or args.stage or args.activate_stage:
        require(args.node is not None and args.bwrap is not None,'DEPENDENCIES_REQUIRED')
        if args.stage: stage(package,args.node.resolve(),args.bwrap.resolve())
        else: apply(package,args.node.resolve(),args.bwrap.resolve(),staged=args.activate_stage)
    else:
        raw,m,_=prepared(package)
        print(json.dumps({'status':'CANDIDATE_ONLY','manifestSha256':digest(raw),'host':HOST,'unit':UNIT,'actions':ACTIONS,
            'paths':[str(RUNTIME),str(STATE),str(AUTH),'/etc/systemd/system/'+UNIT],
            'installable':False,'requiredGates':m['requiredGates']}))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'status':'BLOCKED','reason':str(e) if type(e) is Block else 'INSTALL_RESULT_UNKNOWN'}));raise SystemExit(2)
