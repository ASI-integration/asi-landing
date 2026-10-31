"""One EXISTING active Beget Engine: signed state-preserving generation upgrade.

No import-time actions; --plan is strictly read-only and UNSIGNED. --apply is
privileged and requires an owner Ed25519 grant pinned to exact old/new bytes,
this executable, host/unit, current main, reconciled remote PRs, existing
durable state and future signed native activation. No first-install/reenable
API, new Engine, new scheduler, blind FAILED_LOCKED clearing or auto replay.

This source MUST be protected-reviewed, installed root-owned and admitted
separately. A GitHub draft branch, chat permission or successful tests alone
never meet that grant. It intentionally refuses a package without actual
five-lane native host wiring and new 365d parent/child authority.
"""
import argparse
import ctypes
import hashlib
import json
import os
import pwd
from pathlib import Path
import stat
import subprocess
import sys
import time
import urllib.request

HOST='pqukibofpo'
UNIT='asi-strigunov-agent.service'
SERVICE=Path('/etc/systemd/system')/UNIT
RUNTIME=Path('/opt/asi-engine')
STATE=Path('/var/lib/asi-engine')
AUTH=Path('/etc/asi-github-engine')
HISTORY=Path('/var/lib/asi-engine-history')
HISTORY_STATE=['state/autopilot-ledger.json','state/receipts.json',
               'state/heartbeat.json','state/api-budget.json',
               'state/publisher-poll.json','routing/routing.json']
ACTIONS=['reconcile-pr564-pr565-no-replay','preserve-original-runtime-and-state',
         'stop-exact-existing-unit','stage-and-atomic-exchange-generation',
         'adopt-exact-signed-new-native-authority','record-recovery-without-history-loss',
         'restart-exact-existing-unit','verify-host-durable-receipts']
REQUIRED_NATIVE=[
 'scripts/global-dispatcher/task-intake.mjs',
 'scripts/strigunov4/execution-adapters/owner-lane-native-bridge.mjs',
 'scripts/strigunov4/source-responses-provider.mjs',
 'scripts/strigunov4/execution-adapters/standing-request-guard.mjs']
REPO='ASI-integration/asi-landing'
class Block(Exception):pass
def require(ok,code):
    if not ok:raise Block(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def run(args,timeout=30):
    return subprocess.run(args,check=True,timeout=timeout,capture_output=True,
      env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'}).stdout
def regular(p,maxsize=2000000,root=False):
    p=Path(p)
    require(p.is_absolute() and p.resolve()==p,'PATH_NOT_PINNED')
    if root:
        for parent in p.parents:
            st=parent.lstat()
            require(st.st_uid==0 and not st.st_mode&0o022,'ROOT_PARENT_UNSAFE')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        st=os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and
          st.st_size<=maxsize and not st.st_mode&0o022,'FILE_UNSAFE')
        if root:require(st.st_uid==0,'ROOT_FILE_UNSAFE')
        chunks=[];total=0
        while total<=maxsize:
            data=os.read(fd,min(65536,maxsize+1-total))
            if not data:break
            chunks.append(data);total+=len(data)
        raw=b''.join(chunks)
        after=os.fstat(fd)
        require(len(raw)==st.st_size and
          (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==
          (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),
          'FILE_CHANGED_DURING_READ')
        return raw
    finally:os.close(fd)
def jsonb(raw):
    require(len(raw)<=2000000,'JSON_TOO_LARGE')
    value=json.loads(raw)
    require(type(value) is dict,'JSON_OBJECT_REQUIRED')
    return value
def epoch():return int(time.time()*1000)
def syncdir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def put_new(path,raw,mode=0o600):
    path=Path(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        while raw:
            sent=os.write(fd,raw)
            require(sent>0,'WRITE_FAILED')
            raw=raw[sent:]
        os.fsync(fd)
    finally:os.close(fd)
    syncdir(path.parent)
def atomic_replace(path,raw,uid,gid):
    tmp=path.with_name('.'+path.name+'.upgrade-pending')
    require(not tmp.exists(),'PRIOR_UNKNOWN_ATOMIC_WRITE')
    put_new(tmp,raw,0o600)
    os.chown(tmp,uid,gid)
    os.replace(tmp,path)
    syncdir(path.parent)
def exchange(a,b):
    lib=ctypes.CDLL(None,use_errno=True)
    require(hasattr(lib,'renameat2'),'NO_ATOMIC_EXCHANGE')
    fn=lib.renameat2
    fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    fn.restype=ctypes.c_int
    rc=fn(-100,os.fsencode(a),-100,os.fsencode(b),2)
    require(rc==0,'ATOMIC_EXCHANGE_FAILED')
    syncdir(a.parent)
def installed_runtime():
    raw=regular(RUNTIME/'manifest.json',root=True)
    m=jsonb(raw)
    require(m.get('schema')=='asi.beget-engine-source.v1' and
       isinstance(m.get('files'),list) and 10<=len(m['files'])<=100,'OLD_MANIFEST_INVALID')
    seen=set()
    for f in m['files']:
        rel=f.get('path');digest=f.get('sha256')
        require(type(rel) is str and rel.startswith('scripts/') and rel.endswith('.mjs') and
          '..' not in rel.split('/') and rel not in seen and
          type(digest) is str and len(digest)==64 and
          sha(regular(RUNTIME/rel,root=True))==digest,'OLD_SOURCE_TAMPERED')
        seen.add(rel)
    require(sha(regular(SERVICE,root=True))==m['unitSha256'],
            'LIVE_UNIT_CHANGED')
    require(sha(regular(RUNTIME/'node',150000000,root=True))==m['nodeSha256'] and
            sha(regular(RUNTIME/'bwrap',root=True))==m['bwrapSha256'],
            'LIVE_EXECUTABLE_CHANGED')
    return raw,m
def current_state():
    user=pwd.getpwnam('asi-engine')
    st=STATE.lstat()
    require(stat.S_ISDIR(st.st_mode) and st.st_uid==user.pw_uid and
      st.st_gid==user.pw_gid and not st.st_mode&0o077,'PRIVATE_STATE_IDENTITY')
    require(not (STATE/'state/execution.lock').exists() and
            not (STATE/'state/api-budget.lock').exists(),
            'UNKNOWN_IN_FLIGHT_NATIVE_LOCK')
    data={}
    for rel in HISTORY_STATE:
        p=STATE/rel
        s=p.lstat()
        require(stat.S_ISREG(s.st_mode) and s.st_uid==user.pw_uid and
          not s.st_mode&0o077 and s.st_nlink==1,'STATE_FILE_IDENTITY')
        data[rel]=regular(p)
    ledger=jsonb(data['state/autopilot-ledger.json'])
    receipts=jsonb(data['state/receipts.json'])
    budget=jsonb(data['state/api-budget.json'])
    routing=jsonb(data['routing/routing.json'])
    require(ledger.get('mode')=='FAILED_LOCKED' and
      ledger.get('reason')=='UNHANDLED_OR_UNKNOWN_RESULT' and
      receipts.get('version')==1 and len(receipts.get('completed',[]))==2 and
      type(ledger.get('jobs')) is dict and len(ledger['jobs'])==2 and
      type(budget.get('requests')) is int and budget['requests']>=0 and
      type(budget.get('mutations')) is int and budget['mutations']>=0 and
      routing.get('state',{}).get('schema')=='asi.global-routing.v1',
      'FAILED_LOCKED_RECONCILIATION_OUTSIDE_SCOPE')
    expected=[('beget-g2-witness-identity-v1',564),
              ('beget-g2-witness-races-v1',565)]
    for task,pr in expected:
        rec=[x for x in receipts['completed'] if x.get('id')==task]
        job=ledger['jobs'].get(task)
        require(len(rec)==1 and rec[0].get('status')=='PASS' and
          rec[0].get('kind')=='github-publisher' and
          type(job) is dict and job.get('mode')=='PUBLISHED' and
          job.get('report')==rec[0].get('report') and
          job.get('reportSha256')==rec[0].get('reportSha256'),
          'HISTORICAL_RECEIPT_UNRECONCILED')
        data['reports/'+rec[0]['report']]=regular(STATE/'reports'/rec[0]['report'])
        require(sha(data['reports/'+rec[0]['report']])==rec[0]['reportSha256'],
          'HISTORICAL_REPORT_CHANGED')
        rel='state/publication-'+task+'.json'
        data[rel]=regular(STATE/rel)
        j=jsonb(data[rel])
        require(j.get('version')==1 and j.get('phase')=='VERIFIED' and
           j.get('pr')==pr and j.get('baseSha')==rec[0]['sha'] and
           j.get('head') and not j.get('pending'),'REMOTE_PUBLICATION_UNSETTLED')
    # Retain EVERY historical report, including earlier WAITING diagnostics;
    # the two terminal receipts alone do not describe the whole history.
    reports=STATE/'reports'
    report_owner=reports.lstat()
    require(stat.S_ISDIR(report_owner.st_mode) and
        report_owner.st_uid==user.pw_uid and
        not report_owner.st_mode&0o077,'REPORT_HISTORY_DIRECTORY_INVALID')
    names=list(reports.iterdir())
    require(len(names)<=250,'HISTORICAL_REPORT_SET_OVERSIZE')
    for file in names:
        require(file.name.endswith('.txt') and
          file.name.startswith('beget-g2-witness-') and
          file.name not in ('.','..') and file.is_file() and
          not file.is_symlink(),'UNEXPECTED_REPORT_HISTORY_ENTRY')
        key='reports/'+file.name
        content=regular(file)
        require(len(content)<200000,'HISTORICAL_REPORT_TOO_LARGE')
        data[key]=content
    # Every durable publication journal and budget record must be accounted
    # for, not only the ones the operator knew to list in advance.
    state_dir=STATE/'state'
    known={x.split('/',1)[1] for x in HISTORY_STATE if x.startswith('state/')}
    known.update('publication-'+task+'.json' for task,_ in expected)
    found={p.name for p in state_dir.iterdir()}
    require(found==known,'UNKNOWN_OR_MISSING_NATIVE_STATE_FILE')
    return data
def observed_service():
    raw=run(['/usr/bin/systemctl','show',UNIT,
      '-pLoadState','-pActiveState','-pMainPID','-pUser','-pGroup',
      '-pFragmentPath','-pDropInPaths','-pInvocationID']).decode()
    v=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
    require(v.get('LoadState')=='loaded' and v.get('User')=='asi-engine' and
      v.get('Group')=='asi-engine' and v.get('FragmentPath')==str(SERVICE) and
      v.get('DropInPaths')=='','SERVICE_IDENTITY_UNVERIFIED')
    return v
def verify_prs(state):
    for task,pr in [('beget-g2-witness-identity-v1',564),
                    ('beget-g2-witness-races-v1',565)]:
        j=jsonb(state['state/publication-'+task+'.json'])
        url='https://api.github.com/repos/'+REPO+'/pulls/'+str(pr)
        req=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json',
                                                 'User-Agent':'asi-native-upgrade-preflight'})
        with urllib.request.urlopen(req,timeout=15) as reply:
            require(reply.status==200,'GITHUB_PR_UNAVAILABLE')
            obj=jsonb(reply.read(200000))
        require(obj.get('number')==pr and obj.get('state')=='open' and
          obj.get('draft') is True and obj.get('merged') is False and
          obj.get('head',{}).get('sha')==j['head'] and
          obj.get('head',{}).get('ref')==j['branch'] and
          obj.get('base',{}).get('sha')==j['baseSha'] and
          obj.get('changed_files')==1,'HISTORICAL_REMOTE_PR_CONFLICT')
def exact_main(sha_expected):
    result=run(['/usr/bin/git','ls-remote','https://github.com/'+REPO+'.git',
                'refs/heads/main'],timeout=25).decode().split()
    require(result==[sha_expected,'refs/heads/main'],'PROTECTED_MAIN_CHANGED')
def plan(package):
    oldraw,old=installed_runtime()
    # The checked package builder remains source-only until the complete
    # native wiring, signed owner admission and a protected active updater exist.
    from importlib.util import spec_from_file_location,module_from_spec
    src=Path(__file__).with_name('beget-install.py')
    spec=spec_from_file_location('asi_protected_installer',src)
    module=module_from_spec(spec);spec.loader.exec_module(module)
    newraw,new,files=module.prepared(package)
    present={f['path'] for f in new['files']}
    missing=[x for x in REQUIRED_NATIVE if x not in present]
    wired=new.get('nativeFiveLaneWiring')=='REVIEWED_PROTECTED_ACTIVE_RUNTIME_V1'
    return {'status':('SOURCE_PACKAGE_INCOMPLETE' if missing else
                      'NATIVE_HOST_RUNTIME_NOT_WIRED' if not wired else
                      'SIGNED_ACTIVE_UPGRADE_REQUIRED'),
       'missingNativeModules':missing,'oldManifestSha256':sha(oldraw),
       'newManifestSha256':sha(newraw),'oldBaseSha':old['baseSha'],
       'newBaseSha':new['baseSha'],'service':UNIT,'liveStateWillBePreserved':True,
       'authorized':False,'installable':False,'applyPerformed':False}

def protected_admission(package, oldraw,old, state, newraw,new, files, installer):
    """The only authority port: native owner signature over exact bytes."""
    require(os.geteuid()==0 and os.uname().nodename==HOST,'UPGRADE_ROOT_HOST_REQUIRED')
    selfraw=regular(Path(__file__).resolve(),root=True)
    public=regular(AUTH/'owner-public.pem',root=True)
    grant=installer.signed('active-upgrade-approval.json',public)
    now=epoch()
    require(type(grant) is dict and
      grant.get('schema')=='asi.beget-active-reconcile-upgrade.v1' and
      grant.get('host')==HOST and grant.get('unit')==UNIT and
      grant.get('actions')==ACTIONS and
      grant.get('scriptSha256')==sha(selfraw) and
      grant.get('oldManifestSha256')==sha(oldraw) and
      grant.get('newManifestSha256')==sha(newraw) and
      grant.get('newBaseSha')==new.get('baseSha') and
      grant.get('newSourceSha')==new.get('sourceSha') and
      grant.get('oldSourceSha')==old.get('sourceSha') and
      grant.get('oldUnitSha256')==old.get('unitSha256')==new.get('unitSha256') and
      grant.get('oldLedgerMode')=='FAILED_LOCKED' and
      grant.get('oldLedgerReason')=='UNHANDLED_OR_UNKNOWN_RESULT' and
      type(grant.get('notBefore')) is int and
      type(grant.get('expiresAt')) is int and
      grant['notBefore']<=now<grant['expiresAt'] and
      0<grant['expiresAt']-grant['notBefore']<=14*86400000,
      'OWNER_SIGNED_LIVE_UPGRADE_SCOPE')
    hashes={rel:sha(data) for rel,data in state.items()}
    require(grant.get('oldStateDigests')==hashes and
            type(grant.get('newPolicySha256')) is str and
            len(grant['newPolicySha256'])==64 and
            all(c in '0123456789abcdef' for c in grant['newPolicySha256']),
            'SIGNED_DURABLE_STATE_PIN_MISMATCH')
    # The future native 5-lane host must carry an independently reviewed
    # activation, not reuse the legacy two-witness authority.
    next_activation=regular(AUTH/'active-next-activation.json',root=True)
    activation=installer.signed('active-next-activation.json',public)
    require(activation.get('runtimeManifestSha256')==sha(newraw) and
      activation.get('baseSha')==new['baseSha'] and
      activation.get('catalogSha256')==new['catalogSha256'] and
      activation.get('root')==str(STATE),
      'NEXT_ACTIVATION_NOT_BOUND_TO_NEW_RUNTIME')
    next_catalog=regular(AUTH/'active-next-catalog.json',root=True)
    require(sha(next_catalog)==new['catalogSha256'] and
            next_catalog==files['catalog.json'],'NEXT_CATALOG_NOT_BOUND')
    next_reviews=regular(AUTH/'active-next-reviews.json',root=True)
    next_fence=regular(AUTH/'active-next-fence.json',root=True)
    require(sha(next_reviews)==activation.get('reviewsSha256') and
      sha(next_fence)==activation.get('fenceSha256'),
      'NEXT_NATIVE_POLICY_NOT_PINNED')
    reviewraw=regular(AUTH/'active-upgrade-review.json',root=True)
    review=jsonb(reviewraw)
    require(sha(reviewraw)==grant.get('reviewSha256') and
      review.get('schema')=='asi.beget-native-five-lane-upgrade-review.v1' and
      review.get('result')=='PASS' and review.get('reviewedSourceSha')==new['sourceSha'] and
      review.get('reviewedManifestSha256')==sha(newraw) and
      review.get('oldStateDigests')==hashes and
      review.get('nativeFiveLaneAdmissionVerified') is True and
      review.get('realModelBudgetGateVerified') is True and
      review.get('restoreReplayProhibitionVerified') is True,
      'INDEPENDENT_NATIVE_REVIEW_REQUIRED')
    # An owner-grant pin makes the exact independent-review record immutable
    # within this transaction; unreviewed flags alone cannot authorize apply.
    proposed={'activation.json':next_activation,'catalog.json':next_catalog,
       'reviews.json':next_reviews,'fence.json':next_fence}
    for name,raw in proposed.items():
        require(grant.get('nextProtectedSha256',{}).get(name)==sha(raw),
               'NEXT_PROTECTED_AUTHORITY_CHANGED')
    require(grant.get('newPolicySha256')==
      sha(json.dumps(activation,ensure_ascii=False,separators=(',',':')).encode('utf8')),
      'NATIVE_BUDGET_POLICY_SHA_UNVERIFIED')
    return grant,proposed

def verify_generation_preclaim(package):
    # Cross-check the new exact bytes by the original native protected
    # installer parser, which is REUSED, never called with --apply.
    from importlib.util import spec_from_file_location,module_from_spec
    installer_path=Path(__file__).with_name('beget-install.py')
    spec=spec_from_file_location('asi_beget_installer_upgrade',installer_path)
    installer=module_from_spec(spec);spec.loader.exec_module(installer)
    newraw,new,files=installer.prepared(package)
    present={f['path'] for f in new['files']}
    require(all(x in present for x in REQUIRED_NATIVE),'NATIVE_FIVE_LANE_SOURCE_MISSING')
    require(new['installable'] is False and new['unitSha256']==sha(files[UNIT]),
            'NATIVE_PACKAGE_OR_UNIT_UNVERIFIED')
    # A module in a ZIP does not make it callable from host-runtime.
    # The signed release must carry explicit protected-reviewed wiring
    # from the native request path, not just copied candidate roots.
    require(new.get('nativeFiveLaneWiring')=='REVIEWED_PROTECTED_ACTIVE_RUNTIME_V1',
            'FIVE_LANE_HOST_RUNTIME_NOT_WIRED')
    return installer,newraw,new,files

def preflight(package):
    oldraw,old=installed_runtime()
    state=current_state()
    installer,newraw,new,files=verify_generation_preclaim(package)
    grant,proposed=protected_admission(package,oldraw,old,state,newraw,new,files,installer)
    require(oldraw!=newraw and new['baseSha']!=old['baseSha'],
            'LIVE_SAME_GENERATION')
    svc=observed_service()
    require(svc.get('ActiveState')=='active' and
      svc.get('MainPID','0').isdigit() and int(svc['MainPID'])>0 and
      len(svc.get('InvocationID',''))==32,'EXISTING_ENGINE_NOT_ACTIVE')
    exact_main(new['baseSha'])
    verify_prs(state)
    # Re-read both signed grants and all old bytes immediately before mutating.
    require(installer.signed('active-upgrade-approval.json',
      regular(AUTH/'owner-public.pem',root=True))==grant,
      'OWNER_GRANT_CHANGED')
    return oldraw,old,state,installer,newraw,new,files,grant,proposed,svc

def apply(package):
    oldraw,old,state,installer,newraw,new,files,grant,proposed,svc=preflight(package)
    oldhash,newhash=sha(oldraw),sha(newraw)
    # Single destination and single-use claim. No idempotency ambiguity, no
    # overwrite, no prior incomplete attempt reuse and no auto retry.
    temp=Path('/opt')/('.asi-live-upgrade-prepared-'+newhash[:16])
    backup=Path('/opt')/('asi-engine-original-'+oldhash[:16])
    hist=HISTORY/newhash
    claim=AUTH/('active-upgrade-claim-'+oldhash+'-'+newhash+'.json')
    receipt=AUTH/('active-upgrade-receipt-'+newhash+'.json')
    require(not any(p.exists() for p in (temp,backup,hist,claim,receipt)),
            'PRIOR_OR_UNKNOWN_UPGRADE_ATTEMPT')
    require(STATE/'state' in [STATE/'state'], 'STATE_ROOT_INVARIANT')
    # Prepare the new generation while old unit is still serving the
    # previous admission; do not copy or delete any private durable bytes.
    temp.mkdir(mode=0o700)
    for rel,raw in files.items():
        if rel.startswith('scripts/'):
            put_new(temp/rel,raw,0o644)
    put_new(temp/'manifest.json',newraw,0o644)
    put_new(temp/'node',regular(RUNTIME/'node',150000000,root=True),0o755)
    put_new(temp/'bwrap',regular(RUNTIME/'bwrap',root=True),0o755)
    put_new(temp/'beget-install.py',files['beget-install.py'],0o644)
    os.chmod(temp,0o755)
    syncdir(Path('/opt'))
    # Revalidate right before the first external stop, after potentially
    # lengthy packaging. Any changed record -> BLOCK, no stop.
    require({k:sha(v) for k,v in current_state().items()}==
             {k:sha(v) for k,v in state.items()},
             'STATE_MOVED_BEFORE_STOP')
    require(sha(regular(RUNTIME/'manifest.json',root=True))==oldhash and
      observed_service()==svc,'SERVICE_CHANGED_BEFORE_STOP')
    exact_main(new['baseSha'])
    verify_prs(state)
    require(protected_admission(package,oldraw,old,state,newraw,new,files,installer)[0]==grant,
            'GRANT_CHANGED_BEFORE_STOP')
    # Physically quiesce the single existing service, not install another.
    run(['/usr/bin/systemctl','stop',UNIT],timeout=1850)
    stopped=observed_service()
    require(stopped.get('ActiveState')=='inactive' and stopped.get('MainPID')=='0',
            'SERVICE_STOP_OUTCOME_UNKNOWN')
    require({k:sha(v) for k,v in current_state().items()}==
            {k:sha(v) for k,v in state.items()},'STATE_MOVED_DURING_QUIESCE')
    exact_main(new['baseSha'])
    verify_prs(state)
    # Immutable root-only historical snapshot of every relevant ledger,
    # remote journal and accepted report. Original on-disk state stays put.
    hist.mkdir(mode=0o700,parents=True)
    for rel,raw in state.items():put_new(hist/rel,raw)
    for name in proposed:
        put_new(hist/'protected-old'/name,regular(AUTH/name,root=True))
    syncdir(HISTORY)
    put_new(claim,json.dumps({'schema':'asi.beget-active-upgrade-claim.v1',
       'old':oldhash,'new':newhash,'oldLedgerSha256':sha(state['state/autopilot-ledger.json']),
       'ownerGrantSha256':sha(regular(AUTH/'active-upgrade-approval.json',root=True)),
       'oneUse':True},sort_keys=True).encode())
    # No auto retry after claim creation or any uncertain crash.
    oldlocation=temp
    switched=False
    changed_protected=[]
    changed_state=[]
    start_attempted=False
    try:
        exchange(RUNTIME,temp)
        switched=True
        temp.rename(backup)
        oldlocation=backup
        syncdir(Path('/opt'))
        require(sha(regular(RUNTIME/'manifest.json',root=True))==newhash,
                'POST_EXCHANGE_GENERATION_CHANGED')
        # Each changed protected record is archived above and replaced via
        # same-directory atomic rename. If any incomplete, restore before
        # starting new code. The historical record remains root-only.
        for name,raw in proposed.items():
            current=AUTH/name
            existing=regular(current,root=True)
            mode=0o640
            gid=pwd.getpwnam('asi-engine').pw_gid
            pending=AUTH/('.'+name+'.active-upgrade-'+newhash[:12])
            put_new(pending,raw,mode)
            os.chown(pending,0,gid)
            os.replace(pending,current)
            syncdir(AUTH)
            changed_protected.append((name,existing))
        # Preserve original FAILED_LOCKED bytes in root-only HISTORY.
        # The new signed reconciliation is an ADDITIVE irreversible record,
        # not a rewrite of old job or remote publication receipts.
        user=pwd.getpwnam('asi-engine')
        ledger=jsonb(state['state/autopilot-ledger.json'])
        ledger['mode']='IDLE'
        ledger['reconciledFailedLocked']={
          'schema':'asi.beget-signed-live-reconciliation.v1',
          'priorMode':'FAILED_LOCKED',
          'priorReason':ledger.pop('reason'),
          'oldLedgerSha256':sha(state['state/autopilot-ledger.json']),
          'oldManifestSha256':oldhash,
          'newManifestSha256':newhash,
          'ownerGrantSha256':sha(regular(AUTH/'active-upgrade-approval.json',root=True)),
          'oldReceiptsPreserved':True,
          'remotePrs':[564,565]}
        orig_budget=jsonb(state['state/api-budget.json'])
        orig_budget['policySha256']=grant['newPolicySha256']
        heartbeat={'mode':'WAITING','reason':'SIGNED_RECONCILIATION_TO_NEW_MAIN',
                   'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        for rel,obj in [('state/autopilot-ledger.json',ledger),
                        ('state/api-budget.json',orig_budget),
                        ('state/heartbeat.json',heartbeat)]:
            old_bytes=regular(STATE/rel)
            atomic_replace(STATE/rel,
                (json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n').encode(),
                user.pw_uid,user.pw_gid)
            changed_state.append((rel,old_bytes))
        require(sha(regular(STATE/'state/receipts.json'))==
          sha(state['state/receipts.json']),'HISTORICAL_RECEIPTS_TAMPERED')
        # From this boundary, even a failed/unknown start could have sent
        # external effects. Never auto-rollback or replay after start attempt.
        start_attempted=True
        run(['/usr/bin/systemctl','start',UNIT],timeout=120)
        active=observed_service()
        require(active.get('ActiveState')=='active' and
          active.get('MainPID','0')!='0' and
          active.get('InvocationID')!=svc.get('InvocationID') and
          sha(regular(RUNTIME/'manifest.json',root=True))==newhash,
          'POST_UPGRADE_SERVICE_NOT_ACCEPTED')
        put_new(receipt,json.dumps({'schema':'asi.beget-signed-live-upgrade-receipt.v1',
          'old':oldhash,'new':newhash,
          'oldRootBackup':str(backup),'oldStateBackup':str(hist),
          'oldInvocationId':svc.get('InvocationID'),
          'newInvocationId':active['InvocationID'],
          'oldReceiptsSha256':sha(state['state/receipts.json']),
          'historicFailedLedgerSha256':sha(state['state/autopilot-ledger.json']),
          'ownerGrantSha256':sha(regular(AUTH/'active-upgrade-approval.json',root=True)),
          'publisherReplayAllowed':False,
          'postUpgradeAcceptance':'SERVICE_RUNNING_ONLY_REAL_TASK_PENDING'},sort_keys=True).encode())
        return {'status':'NEW_ENGINE_RUNNING_FIVE_LANE_E2E_PENDING',
           'oldManifestSha256':oldhash,'newManifestSha256':newhash,
           'oldGenerationBackup':str(backup),'history':str(hist),
           'publisherReplayAllowed':False}
    except Exception:
        # Before new process can run, local generation and authorization
        # rollback may be safe; after service start or an uncertain start
        # outcome NEVER blindly roll back or retry remote side effects.
        if start_attempted:
            raise Block('POST_START_UNKNOWN_EFFECT_RECONCILIATION_REQUIRED')
        current=observed_service()
        if current.get('ActiveState')!='active' and switched:
            try:
                for rel,raw in reversed(changed_state):
                    u=pwd.getpwnam('asi-engine')
                    atomic_replace(STATE/rel,raw,u.pw_uid,u.pw_gid)
                for name,raw in reversed(changed_protected):
                    current=AUTH/name
                    pending=AUTH/('.'+name+'.recovery-'+newhash[:12])
                    put_new(pending,raw)
                    os.chown(pending,0,pwd.getpwnam('asi-engine').pw_gid)
                    os.replace(pending,current)
                    syncdir(AUTH)
                exchange(RUNTIME,oldlocation)
            except Exception:raise Block('FAILED_LOCKED_OPERATOR_RECONCILIATION_REQUIRED')
        raise Block('UPGRADE_ATTEMPT_TERMINAL_MANUAL_RECONCILIATION')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--package',required=True,type=Path)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--plan',action='store_true')
    modes.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    try:
        package=args.package.resolve(strict=True)
        require(package.is_dir() and package!=RUNTIME and
          not str(package).startswith(str(STATE)+'/'),'PACKAGE_SCOPE_INVALID')
        if args.apply:
            print(json.dumps(apply(package),sort_keys=True))
        else:
            print(json.dumps(plan(package),sort_keys=True))
    except Exception as exc:
        # Do not leak API, owner key, signatures, file content or external
        # provider exceptions into stdout. Emit fixed reason only.
        code=str(exc) if isinstance(exc,Block) else 'NATIVE_UPGRADE_PREFLIGHT_OR_APPLY_FAILED'
        print(json.dumps({'status':'BLOCKED','reason':code,'applied':False},sort_keys=True))
        sys.exit(1)

if __name__=='__main__':
    main()
