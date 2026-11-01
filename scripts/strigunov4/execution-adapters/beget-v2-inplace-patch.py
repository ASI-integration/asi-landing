"""Signed V2-to-V2 in-place repair of the ONE existing Beget Engine.

Never use the original FAILED_LOCKED->V2 installer against a live V2 ledger.
No import-time I/O. Requires a new exact owner Ed25519 one-use grant, separately
owner-signed manifest-bound activation, genuine exact-head green GitHub CI,
preserved signed parent/child/catalog, idle original journal and no unknown PR
publication. This is source pending protected independent validation.
"""
import argparse
import importlib.util
import json
import hashlib
import os
import pwd
import shutil
from pathlib import Path
import stat
import time

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('asi_old_v2_upgrade',ROOT/'beget-live-upgrade.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
AUTH=old.AUTH
UNIT=old.UNIT
STATE=old.STATE
RUNTIME=old.RUNTIME
HISTORY=old.HISTORY
REPO=old.REPO
GRANT='active-v2-patch-one-use-approval.json'
NEXT='active-v2-patch-next-activation.json'
CURRENT='activation.json'
ALLOWED={
 'scripts/strigunov4/ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs',
 'scripts/strigunov4/execution-adapters/beget-native-five-lane-source.mjs',
 'scripts/strigunov4/execution-adapters/owner-lane-native-bridge.mjs',
 'scripts/strigunov4/execution-adapters/publication-loop.mjs'
}
ACTIONS=['patch-exact-existing-v2-service','preserve-all-pr-and-model-claims',
         'replace-only-signed-activation','migrate-hashes-no-counter-reset',
         'restart-one-service-no-replay']
class Denied(Exception):pass
def need(ok, reason):
    if not ok:raise Denied(reason)
def hash_bytes(data):return hashlib.sha256(data).hexdigest()
def json_bytes(value):
    return (json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode()
def policy_bytes(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
def load_root(path):
    return old.regular(path,root=True)
def old_new_files(a,b):
    def check(m):
        result={}
        for f in m['files']:
            p=f['path']
            need(p not in result,'DUPLICATE_SOURCE_PATH')
            result[p]=f['sha256']
        return result
    x,y=check(a),check(b)
    need(set(x)==set(y) and len(x)>=30,'V2_SOURCE_SET_CHANGED')
    changed={p for p in x if x[p]!=y[p]}
    need(bool(changed) and changed.issubset(ALLOWED),'UNREVIEWED_RUNTIME_MODULE')
    for field in ('schema','baseSha','catalogSha256','unitSha256','nodeSha256','bwrapSha256'):
        need(a[field]==b[field],'V2_BASE_POLICY_OR_BINARY_CHANGED')
    need(a['nativeFiveLaneWiring']==b['nativeFiveLaneWiring']==
         'OWNER_SIGNED_TECHNICAL_ACCEPTANCE_V1','V2_OWNER_WIRING_CHANGED')
    return sorted(changed)
def model_hash(activation):
    return hash_bytes(policy_bytes({'model':activation['model'],
      'sourceSha':activation['baseSha'],'repo':activation['repo'],
      'activation':activation['runtimeManifestSha256']}))
def api_hash(activation):
    return hash_bytes(policy_bytes(activation))
def preserve_ledger(ledger,old_activation,new_activation):
    need(ledger.get('mode')=='IDLE' and
         isinstance(ledger.get('reconciledFailedLocked'),dict) and
         isinstance(ledger.get('jobs'),dict) and len(ledger['jobs'])>=2 and
         ledger.get('nativeFiveLaneTask') is None and
         isinstance(ledger.get('ownerLaneJournal'),dict) and
         len(ledger['ownerLaneJournal'].get('lanes',{}))==5,
         'V2_NOT_QUIESCENT_OR_RECONCILED')
    for lane in ledger['ownerLaneJournal']['lanes'].values():
        need(lane.get('mode') in ('READY','BLOCKED','DONE'),
             'UNKNOWN_LANE_REQUIRES_OPERATOR')
    m=ledger.get('modelReservationBudget')
    need(isinstance(m,dict) and m.get('version')==1 and
         m.get('policySha256')==model_hash(old_activation) and
         isinstance(m.get('claims'),list) and
         isinstance(m.get('spentMicrousd'),int) and
         m['spentMicrousd']==sum(x.get('microusd',-1) for x in m['claims']),
         'EXISTING_MODEL_SPEND_INVALID')
    fingerprints=[(x['taskId'],x['model'],x['pathDigest']) for x in m['claims']]
    need(len(set(fingerprints))==len(fingerprints),'REPLAY_CLAIM_DETECTED')
    updated=json.loads(json.dumps(ledger))
    updated['modelReservationBudget']['policySha256']=model_hash(new_activation)
    need(updated['modelReservationBudget']['claims']==m['claims'] and
         updated['modelReservationBudget']['spentMicrousd']==m['spentMicrousd'] and
         updated['jobs']==ledger['jobs'] and
         updated['ownerLaneJournal']==ledger['ownerLaneJournal'],
         'MODEL_HISTORY_REWRITE')
    return updated
def read_state():
    # Only the two V2 policy-hash fields may be changed; every other state
    # and report byte is archived, hashed and preserved verbatim.
    state_dir=STATE/'state'
    need(not (state_dir/'execution.lock').exists() and
         not (state_dir/'api-budget.lock').exists(),'NATIVE_LOCK_PRESENT')
    # Directory/file ownership matters: a signed grant must never authorize
    # snapshotting attacker-controlled or group-writable state at root.
    private_uid=pwd.getpwnam('asi-engine').pw_uid
    files={}
    for sub in ('state','routing','reports'):
        folder=STATE/sub
        st=folder.lstat()
        need(stat.S_ISDIR(st.st_mode) and not folder.is_symlink() and
             st.st_uid==private_uid and not st.st_mode&0o077,
             'LIVE_PRIVATE_STATE_DIRECTORY_IDENTITY')
        for p in sorted(folder.iterdir()):
            identity=p.lstat()
            need(stat.S_ISREG(identity.st_mode) and
                 identity.st_uid==private_uid and identity.st_nlink==1 and
                 not identity.st_mode&0o077 and not p.is_symlink(),
                 'LIVE_PRIVATE_STATE_FILE_IDENTITY')
            files[str(p.relative_to(STATE))]=old.regular(p)
    need(len(files)<=100 and all(len(v)<=200000 for v in files.values()),
         'STATE_SNAPSHOT_LIMIT')
    need(all(x in files for x in ('state/autopilot-ledger.json','state/api-budget.json',
          'state/receipts.json')),'REQUIRED_DURABLE_STATE_MISSING')
    ledger=old.jsonb(files['state/autopilot-ledger.json'])
    receipts=old.jsonb(files['state/receipts.json'])
    budget=old.jsonb(files['state/api-budget.json'])
    need(receipts.get('version')==1 and
         {'beget-g2-witness-identity-v1','beget-g2-witness-races-v1'}.issubset(
            {x.get('id') for x in receipts.get('completed',[])}),
         'HISTORICAL_G2_RECEIPTS_MISSING')
    for p,raw in files.items():
        if p.startswith('state/publication-'):
            record=old.jsonb(raw)
            need(record.get('phase')=='VERIFIED' and
                 not record.get('pending'),'PUBLISHER_OPERATION_UNCERTAIN')
    return files,ledger,receipts,budget
def preflight(package,require_owner=True):
    need(os.geteuid()==0 and os.uname().nodename==old.HOST,'ROOT_BEGET_REQUIRED')
    src=Path(__file__).resolve()
    need(src.is_absolute() and src.parent==ROOT,'PINNED_EXECUTOR_PATH')
    raw_old,manifest_old=old.installed_runtime()
    from importlib.util import spec_from_file_location,module_from_spec
    s=spec_from_file_location('asi_native_install',ROOT/'beget-install.py')
    installer=module_from_spec(s);s.loader.exec_module(installer)
    raw_new,manifest_new,content=installer.prepared(package)
    changed=old_new_files(manifest_old,manifest_new)
    need(manifest_old['sourceSha']!=manifest_new['sourceSha'],
         'NEW_SOURCE_SHA_REQUIRED')
    public=load_root(AUTH/'owner-public.pem')
    prev=installer.signed(CURRENT,public)
    proposed=installer.signed(NEXT,public)
    need(prev.get('schema')==proposed.get('schema')==
         'asi.engine-beget-five-lane-activation.v1' and
         prev.get('runtimeManifestSha256')==hash_bytes(raw_old) and
         proposed.get('runtimeManifestSha256')==hash_bytes(raw_new),
         'GENUINE_MANIFEST_BOUND_ACTIVATIONS_REQUIRED')
    a,b=dict(prev),dict(proposed)
    a.pop('runtimeManifestSha256');b.pop('runtimeManifestSha256')
    need(a==b,'SIGNED_AUTHORITY_OR_BUDGET_EXPANSION')
    data,ledger,receipts,budget=read_state()
    next_ledger=preserve_ledger(ledger,prev,proposed)
    need(budget.get('policySha256')==api_hash(prev) and
         isinstance(budget.get('requests'),int) and
         isinstance(budget.get('mutations'),int) and
         0<=budget['mutations']<=budget['requests'],
         'EXISTING_API_BUDGET_UNVERIFIED')
    next_budget=dict(budget)
    next_budget['policySha256']=api_hash(proposed)
    hashes={p:hash_bytes(v) for p,v in data.items()}
    service=old.observed_service()
    need(service['ActiveState']=='active' and
         service['MainPID'].isdigit() and int(service['MainPID'])>0,
         'ONE_RUNNING_SERVICE_REQUIRED')
    if require_owner:
        grant=installer.signed(GRANT,public)
        now=old.epoch()
        need(grant.get('schema')=='asi.beget-v2-inplace-patch-grant.v1' and
             grant.get('host')==old.HOST and grant.get('unit')==UNIT and
             grant.get('actions')==ACTIONS and
             grant.get('oldManifestSha256')==hash_bytes(raw_old) and
             grant.get('newManifestSha256')==hash_bytes(raw_new) and
             grant.get('sourceSha')==manifest_new['sourceSha'] and
             grant.get('baseSha')==manifest_new['baseSha'] and
             grant.get('oldStateDigests')==hashes and
             grant.get('oldActivationSha256')==hash_bytes(load_root(AUTH/CURRENT)) and
             grant.get('newActivationSha256')==hash_bytes(load_root(AUTH/NEXT)) and
             grant.get('scriptSha256')==hash_bytes(load_root(src)) and
             grant.get('modelPolicySha256')==model_hash(proposed) and
             grant.get('apiPolicySha256')==api_hash(proposed) and
             type(grant.get('validationRunId')) is int and
             type(grant.get('notBefore')) is int and
             type(grant.get('expiresAt')) is int and
             grant['notBefore']<=now<grant['expiresAt'] and
             0<grant['expiresAt']-grant['notBefore']<=14*86400000,
             'OWNER_SIGNED_ONE_USE_PATCH_REQUIRED')
        installer.verified_owner_ci_run(grant['validationRunId'],311380800,
                 manifest_new['sourceSha'],'pull_request')
    else:
        grant=None
    old.exact_main(manifest_new['baseSha'])
    return dict(raw_old=raw_old,raw_new=raw_new,manifest_new=manifest_new,
       content=content,data=data,hashes=hashes,service=service,
       grant=grant,changed=changed,newActivation=load_root(AUTH/NEXT),
       oldActivation=load_root(AUTH/CURRENT),
       ledger=next_ledger,budget=next_budget)
def stop_one_existing_engine(observe, stop, previous):
    """Classify a failed stop before any code/state exchange or external replay.

    Never treat a systemctl error as proof the original service is stopped;
    do not auto-restart an unknown in-flight publisher operation.
    """
    need(previous.get('ActiveState')=='active' and
         previous.get('MainPID','0').isdigit() and
         int(previous['MainPID'])>0,
         'ORIGINAL_ENGINE_IDENTITY_REQUIRED')
    try:
        stop()
    except Exception:
        try:
            current=observe()
        except Exception:
            raise Denied('STOP_OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION')
        need(isinstance(current,dict),
             'STOP_OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION')
        if (current.get('ActiveState')=='active' and
            current.get('MainPID')==previous['MainPID'] and
            current.get('InvocationID')==previous.get('InvocationID')):
            raise Denied('STOP_FAILED_OLD_ENGINE_STILL_RUNNING')
        raise Denied('STOP_OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION')
    try:
        current=observe()
    except Exception:
        raise Denied('STOP_OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION')
    need(isinstance(current,dict) and
         current.get('ActiveState')=='inactive' and
         current.get('MainPID')=='0',
         'STOP_OUTCOME_UNKNOWN_OPERATOR_RECONCILIATION')
    return current

def stage_source_bytes_with_mode(target, raw, mode):
    """Never trust inherited root umask: executable and source files MUST
    be usable by the original unprivileged asi-engine service after swap.
    """
    need(mode in (0o644,0o755),'SOURCE_STAGE_MODE_NOT_ALLOWED')
    old.put_new(target,raw,mode)
    os.chmod(target,mode)
    st=target.lstat()
    need(stat.S_ISREG(st.st_mode) and not target.is_symlink() and
         st.st_uid==os.geteuid() and stat.S_IMODE(st.st_mode)==mode,
         'STAGED_ENGINE_FILE_MODE_UNVERIFIED')
    return True

def restore_original_activation_bytes(raw, gid):
    """Pre-start rollback restores group-read mode for existing asi-engine UID.

    The generic state atomic_replace writes 0600, which is NOT valid for
    root:asi-engine signed activation files that must remain readable by
    the service after a pre-start rollback.
    """
    need(isinstance(raw,bytes) and 0<len(raw)<=2000000,
         'ROLLBACK_ACTIVATION_INVALID')
    pending=AUTH/('.activation.rollback-'+hash_bytes(raw)[:16])
    need(not pending.exists(),'PRIOR_ROLLBACK_ACTIVATION_UNCERTAIN')
    old.put_new(pending,raw,0o640)
    os.chown(pending,0,gid)
    os.chmod(pending,0o640)
    os.replace(pending,AUTH/CURRENT)
    old.syncdir(AUTH)
    need(load_root(AUTH/CURRENT)==raw,
         'ROLLBACK_ACTIVATION_BYTES_CHANGED')
    return True

def run_apply(package):
    p=preflight(package)
    oldsha,newsha=hash_bytes(p['raw_old']),hash_bytes(p['raw_new'])
    stage=Path('/opt')/('.asi-v2-patch-stage-'+newsha[:16])
    backup=Path('/opt')/('asi-engine-pre-v2-patch-'+oldsha[:16])
    history=HISTORY/('v2-patch-'+newsha)
    receipt=AUTH/('v2-patch-receipt-'+newsha+'.json')
    claim=AUTH/('v2-patch-claim-'+oldsha+'-'+newsha+'.json')
    need(not any(x.exists() for x in (stage,backup,history,receipt,claim)),
         'PRIOR_PATCH_OR_UNCERTAIN_OUTCOME')
    # Prepare bytes before stopping the only Engine. Preserve old manifest
    # and pinned binaries; create traversable source dirs (not 0700 bug).
    stage.mkdir(mode=0o755)
    os.chmod(stage,0o755)
    for rel,value in p['content'].items():
        if rel.startswith('scripts/'):
            target=stage/rel
            target.parent.mkdir(parents=True,mode=0o755,exist_ok=True)
            for parent in target.parents:
                if parent==stage:break
                if str(parent).startswith(str(stage)+'/'):os.chmod(parent,0o755)
            stage_source_bytes_with_mode(target,value,0o644)
    for name,value,mode in [('manifest.json',p['raw_new'],0o644),
          ('node',old.regular(RUNTIME/'node',150000000,root=True),0o755),
          ('bwrap',old.regular(RUNTIME/'bwrap',2000000,root=True),0o755),
          ('beget-install.py',p['content']['beget-install.py'],0o644)]:
        stage_source_bytes_with_mode(stage/name,value,mode)
    old.syncdir(Path('/opt'))
    verify=preflight(package)
    need(verify['hashes']==p['hashes'] and
         verify['service']==p['service'],'LIVE_STATE_CHANGED_BEFORE_STOP')
    stop_one_existing_engine(old.observed_service,
        lambda:old.run(['/usr/bin/systemctl','stop',UNIT],timeout=1850),
        p['service'])
    switched=False
    start_attempted=False
    try:
        need(old.observed_service()['ActiveState']=='inactive',
             'SERVICE_STOP_UNCERTAIN')
        for path,expected in p['hashes'].items():
            need(hash_bytes(old.regular(STATE/path))==expected,
                 'STATE_CHANGED_AFTER_STOP')
        history.mkdir(mode=0o700,parents=True)
        for path,value in p['data'].items():
            old.put_new(history/path,value)
        old.put_new(history/'old-activation.json',load_root(AUTH/CURRENT))
        old.syncdir(HISTORY)
        old.put_new(claim,json_bytes({
             'schema':'asi.beget-v2-patch-claim.v1','old':oldsha,
             'new':newsha,'ownerGrantSha256':hash_bytes(load_root(AUTH/GRANT)),
             'oldStateDigests':p['hashes']}))
        old.exchange(RUNTIME,stage);switched=True
        stage.rename(backup);old.syncdir(Path('/opt'))
        need(hash_bytes(load_root(RUNTIME/'manifest.json'))==newsha,
             'RUNTIME_EXCHANGE_UNVERIFIED')
        u=pwd.getpwnam('asi-engine')
        old.atomic_replace(STATE/'state/autopilot-ledger.json',
           json_bytes(p['ledger']),u.pw_uid,u.pw_gid)
        old.atomic_replace(STATE/'state/api-budget.json',
           json_bytes(p['budget']),u.pw_uid,u.pw_gid)
        pending=AUTH/('.activation.v2-patch-'+newsha[:16])
        old.put_new(pending,p['newActivation'],0o640)
        os.chown(pending,0,u.pw_gid)
        os.chmod(pending,0o640)
        os.replace(pending,AUTH/CURRENT);old.syncdir(AUTH)
        need(hash_bytes(load_root(AUTH/CURRENT))==
             hash_bytes(p['newActivation']),'ACTIVATION_EXCHANGE_UNVERIFIED')
        # Even a failed start may have produced irreversible effects.
        start_attempted=True
        old.run(['/usr/bin/systemctl','start',UNIT],timeout=120)
        active=old.observed_service()
        need(active['ActiveState']=='active' and
             active['MainPID']!='0' and
             active.get('InvocationID')!=p['service'].get('InvocationID'),
             'ENGINE_START_NOT_CONFIRMED')
        old.put_new(receipt,json_bytes({
           'schema':'asi.beget-v2-inplace-patch-receipt.v1',
           'old':oldsha,'new':newsha,'oldPid':p['service']['MainPID'],
           'newPid':active['MainPID'],
           'oldInvocationId':p['service'].get('InvocationID'),
           'newInvocationId':active.get('InvocationID'),
           'historicalState':str(history),
           'ownerGrantSha256':hash_bytes(load_root(AUTH/GRANT)),
           'liveAutonomyProven':False,'restartRecoveryProven':False,
           'modelRequestReplayAllowed':False}))
        return {'status':'V2_PATCH_RUNNING_AUTONOMY_UNPROVEN','newPid':active['MainPID'],
                'applied':True,'autonomyProven':False}
    except Exception:
        if start_attempted:raise Denied('POST_START_UNKNOWN_OUTCOME_OPERATOR_RECONCILIATION')
        # The new process was NEVER started. Restore the old generation,
        # activation and original history byte-for-byte before one controlled
        # restart of the previously signed source. Any uncertain restoration
        # stops; no blind retry or deletion of the one-use claim.
        try:
            need(old.observed_service()['ActiveState']=='inactive',
                 'ROLLBACK_SERVICE_NOT_QUIESCENT')
            if switched:
                oldlocation=backup if backup.exists() else stage
                need(oldlocation.is_dir() and
                     hash_bytes(old.regular(oldlocation/'manifest.json',root=True))==oldsha,
                     'ROLLBACK_OLD_GENERATION_UNVERIFIED')
                old.exchange(RUNTIME,oldlocation)
            user=pwd.getpwnam('asi-engine')
            for rel in ('state/autopilot-ledger.json','state/api-budget.json'):
                original=p['data'][rel]
                if old.regular(STATE/rel)!=original:
                    old.atomic_replace(STATE/rel,original,user.pw_uid,user.pw_gid)
            if load_root(AUTH/CURRENT)!=p['oldActivation']:
                restore_original_activation_bytes(p['oldActivation'],user.pw_gid)
            need(hash_bytes(load_root(RUNTIME/'manifest.json'))==oldsha and
                 all(hash_bytes(old.regular(STATE/rel))==p['hashes'][rel]
                    for rel in ('state/autopilot-ledger.json','state/api-budget.json')) and
                 load_root(AUTH/CURRENT)==p['oldActivation'],
                 'ROLLBACK_BYTES_NOT_VERIFIED')
            # Original source had no new PR publication attempt. A failed
            # original restart is still unknown and requires operator action.
            old.run(['/usr/bin/systemctl','start',UNIT],timeout=120)
            need(old.observed_service()['ActiveState']=='active',
                 'ROLLBACK_OLD_ENGINE_START_NOT_CONFIRMED')
        except Exception:
            raise Denied('PRESTART_PATCH_ROLLBACK_UNCERTAIN_OPERATOR_REQUIRED')
        raise Denied('PRESTART_PATCH_RESTORED_NO_NEW_EFFECTS')
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--package',required=True,type=Path)
    group=ap.add_mutually_exclusive_group(required=True)
    group.add_argument('--plan',action='store_true')
    group.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    try:
        package=args.package.resolve(strict=True)
        need(package!=RUNTIME and not str(package).startswith(str(STATE)+'/'),
             'UNSAFE_PACKAGE_LOCATION')
        if args.plan:
            try:
                p=preflight(package)
                result={'status':'OWNER_SIGNED_PATCH_PREFLIGHT_PASS','authorized':True,
                    'applied':False,'changedModules':p['changed']}
            except Denied as e:
                result={'status':'BLOCKED','reason':str(e),'authorized':False,
                        'applied':False}
        else:result=run_apply(package)
        print(json.dumps(result,sort_keys=True))
    except Exception as e:
        code=str(e) if isinstance(e,Denied) else 'PROTECTED_PATCH_UNVERIFIED'
        print(json.dumps({'status':'BLOCKED','reason':code,'applied':False},
              sort_keys=True))
        raise SystemExit(1)
if __name__=='__main__':main()