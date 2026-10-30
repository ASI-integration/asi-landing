"""One-use owner-signed repair of an ALREADY STAGED and DISABLED ASI Engine.

This module never enables or starts the service. It preserves /var/lib/asi-engine,
the original staged generation and all root-owned stage/claim evidence. A signed
repair is NOT a live activation. Protected review is required before any use.
No network access except exact protected-main verification; no secret reads.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys
import time

ENGINE=Path('/opt/asi-engine')
STATE=Path('/var/lib/asi-engine')
AUTH=Path('/etc/asi-github-engine')
BACKUP_ROOT=Path('/opt')
SERVICE=Path('/etc/systemd/system/asi-strigunov-agent.service')
UNIT='asi-strigunov-agent.service'
HOST='pqukibofpo'
SCHEMA='asi.beget-staged-generation-repair.v1'
ACTIONS=['repair-disabled-staged-runtime','preserve-state','preserve-original-generation','remain-disabled']
INSTALLER_PATH=Path(__file__).with_name('beget-install.py')
def sha(raw): return hashlib.sha256(raw).hexdigest()
def safe(ok,why):
    if not ok: raise RuntimeError(why)
def installer():
    spec=importlib.util.spec_from_file_location('asi_beget_exact_installer',INSTALLER_PATH)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def stopped(i):
    status=i.call(['/usr/bin/systemctl','show',UNIT,
        '-pLoadState','-pActiveState','-pMainPID','-pUnitFileState',
        '-pFragmentPath','-pDropInPaths','-pUser','-pGroup']).decode()
    props=dict(line.split('=',1) for line in status.splitlines() if '=' in line)
    safe(props=={'LoadState':'loaded','ActiveState':'inactive','MainPID':'0',
        'UnitFileState':'disabled','FragmentPath':str(SERVICE),'DropInPaths':'',
        'User':'asi-engine','Group':'asi-engine'},'REPAIR_UNIT_NOT_DISABLED')
    return props

def old_generation(i):
    oldraw=i.regular_bytes(ENGINE/'manifest.json',root=True)
    old=json.loads(oldraw)
    safe(type(old) is dict and old.get('schema')=='asi.beget-engine-source.v1',
         'REPAIR_OLD_MANIFEST')
    digest=sha(oldraw)
    receipt=json.loads(i.regular_bytes(AUTH/('staged-isolation-'+digest+'.json'),root=True))
    safe(type(receipt) is dict and receipt.get('schema')=='asi.beget-staged-isolation.v1' and
         receipt.get('manifestSha256')==digest and receipt.get('unitSha256')==old['unitSha256'] and
         receipt.get('nodeSha256')==i.NODE_SHA and receipt.get('bwrapSha256')==i.BWRAP_SHA,
         'REPAIR_OLD_STAGED_RECEIPT')
    claim=json.loads(i.regular_bytes(AUTH/('stage-claim-'+digest+'.json'),root=True))
    safe(type(claim) is dict and claim.get('manifestSha256')==digest and claim.get('oneUse') is True,
         'REPAIR_OLD_STAGE_CLAIM')
    owner=i.regular_bytes(AUTH/'owner-public.pem',root=True)
    stage=i.signed('stage-approval.json',owner)
    safe(stage.get('schema')==i.STAGE_SCHEMA and stage.get('host')==HOST and
         stage.get('unit')==UNIT and stage.get('manifestSha256')==digest and
         stage.get('sourceSha')==old['sourceSha'] and stage.get('baseSha')==old['baseSha'] and
         stage.get('unitSha256')==old['unitSha256'] and stage.get('actions')==i.STAGE_ACTIONS,
         'REPAIR_OLD_STAGE_SIGNATURE')
    for entry in old['files']:
        name=entry['path']
        safe(name.startswith('scripts/') and name.endswith('.mjs') and
             '..' not in name.split('/') and
             sha(i.regular_bytes(ENGINE/name,root=True))==entry['sha256'],
             'REPAIR_OLD_SOURCE_CHANGED')
    safe(sha(i.regular_bytes(ENGINE/'node',root=True,limit=150000000))==i.NODE_SHA and
         sha(i.regular_bytes(ENGINE/'bwrap',root=True))==i.BWRAP_SHA and
         sha(i.regular_bytes(SERVICE,root=True))==old['unitSha256'],
         'REPAIR_OLD_DEPENDENCY_CHANGED')
    identity=pwd.getpwnam('asi-engine')
    st=STATE.lstat()
    safe(stat.S_ISDIR(st.st_mode) and st.st_uid==identity.pw_uid and
         st.st_gid==identity.pw_gid and not st.st_mode&0o077 and
         identity.pw_uid==receipt.get('uid'),
         'REPAIR_STATE_IDENTITY')
    return oldraw,old,owner,receipt

def scope(grant,oldraw,newraw,old,new,now):
    safe(type(grant) is dict and grant.get('schema')==SCHEMA and
         grant.get('host')==HOST and grant.get('unit')==UNIT and
         grant.get('actions')==ACTIONS and
         grant.get('oldManifestSha256')==sha(oldraw) and
         grant.get('newManifestSha256')==sha(newraw) and
         grant.get('oldBaseSha')==old['baseSha'] and
         grant.get('newBaseSha')==new['baseSha'] and
         grant.get('newSourceSha')==new['sourceSha'] and
         grant.get('newCatalogSha256')==new['catalogSha256'] and
         grant.get('unitSha256')==new['unitSha256'] and
         grant.get('repairScriptSha256')==sha(Path(__file__).read_bytes()) and
         type(grant.get('sourceReviewSha256')) is str and
         type(grant.get('nativeIsolationSha256')) is str and
         type(grant.get('repairReviewSha256')) is str and
         all(len(grant[k])==64 and all(c in '0123456789abcdef' for c in grant[k])
             for k in ('sourceReviewSha256','nativeIsolationSha256','repairReviewSha256')) and
         type(grant.get('notBefore')) is int and
         type(grant.get('expiresAt')) is int and
         grant['notBefore']<=now<grant['expiresAt'] and
         0<grant['expiresAt']-grant['notBefore']<=14*86400000,
         'REPAIR_SIGNED_SCOPE')
    safe(old['unitSha256']==new['unitSha256'],'REPAIR_UNIT_CHANGE_REQUIRES_DIFFERENT_RELEASE')

def independent_evidence(i,grant,new):
    reviewraw=i.regular_bytes(AUTH/'source-review.json',root=True)
    isolationraw=i.regular_bytes(AUTH/'native-isolation.json',root=True)
    repairReviewRaw=i.regular_bytes(AUTH/'repair-review.json',root=True)
    safe(sha(reviewraw)==grant['sourceReviewSha256'] and
         sha(isolationraw)==grant['nativeIsolationSha256'] and
         sha(repairReviewRaw)==grant['repairReviewSha256'],'REPAIR_EVIDENCE_CHANGED')
    try: repairReview=json.loads(repairReviewRaw)
    except (ValueError,UnicodeError): raise RuntimeError('REPAIR_SOURCE_REVIEW_REQUIRED')
    safe(type(repairReview) is dict and
         repairReview.get('schema')=='asi.beget-staged-repair-review.v1' and
         repairReview.get('result')=='PASS' and
         repairReview.get('independent') is True and
         type(repairReview.get('findings')) is int and repairReview['findings']==0 and
         repairReview.get('repairScriptSha256')==grant['repairScriptSha256'] and
         repairReview.get('protectedBaseSha')==new['baseSha'] and
         type(repairReview.get('reviewedPr')) is int and repairReview['reviewedPr']==559 and
         type(repairReview.get('reviewedHead')) is str and
         len(repairReview['reviewedHead'])==40 and
         all(c in '0123456789abcdef' for c in repairReview['reviewedHead']),
         'REPAIR_SOURCE_REVIEW_REQUIRED')
    review=json.loads(reviewraw)
    i.source_review_preclaim(review,new)
    isolation=json.loads(isolationraw)
    safe(isolation.get('host')==HOST and
         isolation.get('unitSha256')==new['unitSha256'] and
         isolation.get('bwrapSha256')==i.BWRAP_SHA and
         isolation.get('result')=='PASS' and isolation.get('networkDenied') is True and
         isolation.get('authorityInaccessible') is True,'REPAIR_NATIVE_ISOLATION_UNVERIFIED')

def exact_main(i,new):
    remote=i.call(['/usr/bin/git','ls-remote',
        'https://github.com/ASI-integration/asi-landing.git','refs/heads/main']).decode().split()
    safe(remote==[new['baseSha'],'refs/heads/main'],'REPAIR_PROTECTED_MAIN_CHANGED')

def plan(package):
    # Intentionally unprivileged: report public SHA and presence only. Root-owned
    # signed receipts are verified again in apply(), never inferred from this plan.
    i=installer()
    newraw,new,_=i.prepared(package)
    oldraw=(ENGINE/'manifest.json').read_bytes()
    old=json.loads(oldraw)
    safe(old['schema']=='asi.beget-engine-source.v1','REPAIR_OLD_MANIFEST')
    stopped(i)
    safe(new['unitSha256']==old['unitSha256'],'REPAIR_UNIT_MISMATCH')
    backup=BACKUP_ROOT/('asi-engine-staged-backup-'+sha(oldraw)[:16])
    claim=AUTH/('repair-claim-'+sha(oldraw)+'-'+sha(newraw)+'.json')
    receipt=AUTH/('staged-isolation-'+sha(oldraw)+'.json')
    return {'status':'SIGNED_REPAIR_REQUIRED','oldManifestSha256':sha(oldraw),
      'newManifestSha256':sha(newraw),'oldBaseSha':old['baseSha'],
      'newBaseSha':new['baseSha'],'oldUnitSha256':old['unitSha256'],
      'newUnitSha256':new['unitSha256'],'rollback':str(backup),
      'priorStatePreserved':str(STATE),'oldStageReceiptPresent':receipt.exists(),
      'existingClaim':claim.exists(),'willStartService':False,
      'authorized':False,'installable':False}

def apply(package):
    # All live file mutation requires independent root operator and an owner
    # Ed25519 signature. A chat request, branch comment or source PR cannot sign.
    i=installer()
    safe(os.geteuid()==0 and os.uname().nodename==HOST,'REPAIR_ROOT_HOST_REQUIRED')
    # The repair executable itself must be a protected root-owned file: an
    # editable operator checkout is never a valid root release executable.
    repair_script=i.regular_bytes(Path(__file__).resolve(),root=True)
    newraw,new,files=i.prepared(package)
    oldraw,old,owner,_=old_generation(i)
    stopped(i)
    safe(old['unitSha256']==new['unitSha256'],'REPAIR_UNIT_CHANGED')
    oldhash,newhash=sha(oldraw),sha(newraw)
    safe(oldhash!=newhash,'REPAIR_SAME_GENERATION')
    grant=i.signed('repair-approval.json',owner)
    now=int(time.time()*1000)
    scope(grant,oldraw,newraw,old,new,now)
    safe(sha(repair_script)==grant['repairScriptSha256'],'REPAIR_EXECUTABLE_CHANGED')
    independent_evidence(i,grant,new)
    exact_main(i,new)
    backup=BACKUP_ROOT/('asi-engine-staged-backup-'+oldhash[:16])
    temp=BACKUP_ROOT/('.asi-engine-repair-pending-'+newhash[:16])
    quarantined=BACKUP_ROOT/('.asi-engine-repair-failed-'+newhash[:16])
    claim=AUTH/('repair-claim-'+oldhash+'-'+newhash+'.json')
    receipt=AUTH/('repaired-stage-'+newhash+'.json')
    safe(not backup.exists() and not temp.exists() and
         not quarantined.exists() and not claim.exists() and
         not receipt.exists(),'REPAIR_ONE_USE_OR_PRIOR_ATTEMPT')
    safe(i.regular_bytes(AUTH/'owner-public.pem',root=True)==owner and
         i.signed('repair-approval.json',owner)==grant,'REPAIR_OWNER_GRANT_CHANGED')
    scope(grant,oldraw,newraw,old,new,int(time.time()*1000))
    safe(i.regular_bytes(Path(__file__).resolve(),root=True)==repair_script,
         'REPAIR_EXECUTABLE_CHANGED')
    old_generation(i); stopped(i); independent_evidence(i,grant,new)
    exact_main(i,new)
    # Stage new source *without touching old state or runtime* before one-use claim.
    temp.mkdir(mode=0o700)
    try:
        for name,blob in files.items():
            if name.startswith('scripts/'):
                i.write_new(temp/name,blob,0o644)
        i.write_new(temp/'manifest.json',newraw,0o644)
        i.write_new(temp/'node',i.regular_bytes(ENGINE/'node',root=True,limit=150000000),0o755)
        i.write_new(temp/'bwrap',i.regular_bytes(ENGINE/'bwrap',root=True),0o755)
        i.write_new(temp/'beget-install.py',files['beget-install.py'],0o644)
        # The service UID must be able to traverse the committed runtime root.
        # Keep the work-in-progress hidden until all exact content is written.
        os.chmod(temp,0o755)
        # This claim is irreversible, including when the swap fails/rolls back.
        old_generation(i);stopped(i)
        scope(i.signed('repair-approval.json',owner),oldraw,newraw,old,new,int(time.time()*1000))
        independent_evidence(i,grant,new);exact_main(i,new)
        i.write_new(claim,json.dumps({'oldManifestSha256':oldhash,
          'newManifestSha256':newhash,'oneUse':True}).encode())
        swapped=False
        try:
            ENGINE.rename(backup)
            temp.rename(ENGINE);swapped=True
            safe(sha(i.regular_bytes(ENGINE/'manifest.json',root=True))==newhash,
                 'REPAIR_NEW_RUNTIME_MISMATCH')
            stopped(i)
            i.write_new(receipt,json.dumps({'schema':'asi.beget-disabled-repaired-stage.v1',
              'oldManifestSha256':oldhash,'newManifestSha256':newhash,
              'ownerGrantSha256':sha(i.regular_bytes(AUTH/'repair-approval.json',root=True)),
              'serviceStarted':False,'originalBackup':str(backup)},sort_keys=True).encode())
            return {'status':'DISABLED_REPAIR_STAGE_ONLY','manifestSha256':newhash,
              'serviceStarted':False,'needsSeparatelySignedActivation':True}
        except Exception:
            # Fail closed with an irreversible claim and untouched state.
            if swapped:
                ENGINE.rename(quarantined)
                backup.rename(ENGINE)
            elif not ENGINE.exists() and backup.exists():
                backup.rename(ENGINE)
            raise
    finally:
        # Keep any partial temp and one-use claim for manual review; no
        # automatic second attempt if storage outcome is uncertain.
        pass

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--package',required=True,type=Path)
    choice=ap.add_mutually_exclusive_group()
    choice.add_argument('--plan',action='store_true')
    choice.add_argument('--apply-disabled-repair',action='store_true')
    args=ap.parse_args()
    package=args.package.resolve()
    if args.apply_disabled_repair:print(json.dumps(apply(package),sort_keys=True))
    else:print(json.dumps(plan(package),sort_keys=True))
if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'status':'BLOCKED','reason':str(e) if type(e) is RuntimeError else 'REPAIR_RESULT_UNKNOWN'}))
        sys.exit(2)
