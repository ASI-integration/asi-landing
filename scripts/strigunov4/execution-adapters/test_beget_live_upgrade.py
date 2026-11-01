"""Exact mock state; never opens live Beget paths or invokes systemctl."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import tempfile
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('asi_native_one_upgrade',HERE/'beget-live-upgrade.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
def sha(b):return hashlib.sha256(b).hexdigest()
def payload(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    p.write_bytes((json.dumps(obj)+'\n').encode())
def setup(root):
    (root/'state').mkdir(mode=0o700)
    (root/'routing').mkdir(mode=0o700)
    (root/'reports').mkdir(mode=0o700)
    ledger={'mode':'FAILED_LOCKED','reason':'UNHANDLED_OR_UNKNOWN_RESULT','jobs':{}}
    receipts={'version':1,'completed':[]}
    for name,pr in [('beget-g2-witness-identity-v1',564),('beget-g2-witness-races-v1',565)]:
        fname=name+'-fixture.txt'
        report=(json.dumps({'task':name,'result':{'pr':pr}})+'\n').encode()
        (root/'reports'/fname).write_bytes(report)
        ledger['jobs'][name]={'mode':'PUBLISHED','report':fname,
                              'reportSha256':sha(report)}
        receipts['completed'].append({'id':name,'status':'PASS','kind':'github-publisher',
               'sha':'a'*40,'report':fname,'reportSha256':sha(report)})
        payload(root/'state'/('publication-'+name+'.json'),{
          'version':1,'phase':'VERIFIED','pr':pr,'baseSha':'a'*40,
          'head':'b'*40,'branch':'asi/engine-task/'+name,'pending':None})
        payload(root/'reports'/(name+'-old-waiting.txt'),{'task':name,'result':{'status':'WAITING'}})
    payload(root/'state/autopilot-ledger.json',ledger)
    payload(root/'state/receipts.json',receipts)
    payload(root/'state/heartbeat.json',{'mode':'BLOCKED'})
    payload(root/'state/api-budget.json',{'requests':1375,'mutations':8})
    payload(root/'state/publisher-poll.json',{'at':1,'count':4,'limit':1800})
    payload(root/'routing/routing.json',{'state':{'schema':'asi.global-routing.v1'}})
def native_catalog_fixture():
    base='d'*40
    tasks=[]
    for i,(lane,branch) in enumerate(u.FIVE_OWNER_LANES):
        tasks.append({'id':'accepted-five-'+str(i),'laneId':lane,
          'repo':u.REPO,'branch':branch,'baseSha':base,
          'stage':'S4-G2','kind':'source-proposal',
          'objective':'Review exact bounded test changes without modifying production',
          'files':[{'path':'scripts/strigunov4/fixture-'+str(i)+'.mjs',
                    'beforeSha256':format(i+1,'x')*64}]})
    raw=(json.dumps(tasks,indent=2)+'\n').encode()
    return tasks,raw,{'baseSha':base,'catalogSha256':sha(raw)}

class RealUpgradeSourceTests(unittest.TestCase):
    def test_five_lane_journal_created_from_signed_package_bytes_once_only(self):
        catalog,raw,manifest=native_catalog_fixture()
        old={'mode':'FAILED_LOCKED','reason':'UNHANDLED_OR_UNKNOWN_RESULT',
             'jobs':{'beget-g2-witness-identity-v1':{'mode':'PUBLISHED'}}}
        snapshot=json.loads(json.dumps(old))
        j=u.prepare_native_five_lane_journal(manifest,{'catalog.json':raw},old)
        self.assertEqual(old,snapshot,'must never mutate original FAILED_LOCKED ledger')
        self.assertEqual(j['schema'],'asi.beget-owner-lane-journal.v1')
        self.assertEqual(j['engineMode'],'IDLE')
        self.assertEqual(list(j['lanes']),[name for name,_ in u.FIVE_OWNER_LANES])
        for i,(name,_) in enumerate(u.FIVE_OWNER_LANES):
            self.assertEqual(j['lanes'][name],{
                'mode':'READY','taskId':catalog[i]['id'],
                'taskSha':manifest['baseSha'],'lastServedAtMs':0,
                'nextEligibleAtMs':0,'retries':0})
        with self.assertRaisesRegex(u.Block,'NATIVE_OWNER_LANES_ALREADY_INITIALIZED'):
            u.prepare_native_five_lane_journal(manifest,{'catalog.json':raw},
                {**old,'ownerLaneJournal':j})
    def test_signed_five_lane_preconditions_reject_unknown_duplicate_or_moved_scope(self):
        catalog,raw,manifest=native_catalog_fixture()
        samples=[]
        x=json.loads(json.dumps(catalog));x.pop();samples.append(x)
        x=json.loads(json.dumps(catalog));x[0]['id']=x[1]['id'];samples.append(x)
        x=json.loads(json.dumps(catalog));x[2]['files'][0]['path']=x[0]['files'][0]['path'];samples.append(x)
        x=json.loads(json.dumps(catalog));x[0]['branch']='asi/not-admitted';samples.append(x)
        x=json.loads(json.dumps(catalog));x[0]['baseSha']='f'*40;samples.append(x)
        x=json.loads(json.dumps(catalog));x[0]['files'][0]['beforeSha256']=None;samples.append(x)
        x=json.loads(json.dumps(catalog));x[0]['objective']='';samples.append(x)
        x=json.loads(json.dumps(catalog));x[0]['secretKey']='unauthorized';samples.append(x)
        for sample in samples:
            source=(json.dumps(sample,indent=2)+'\n').encode()
            with self.subTest(sample=str(sample[0])[:80]):
                with self.assertRaisesRegex(u.Block,
                    'NATIVE_FIVE_LANE_CATALOG_INVALID|NATIVE_FIVE_LANE_TASK_SCOPE|NATIVE_FIVE_LANE_SOURCE_SCOPE'):
                    u.prepare_native_five_lane_journal(
                        {**manifest,'catalogSha256':sha(source)},
                        {'catalog.json':source},{})
        with self.assertRaisesRegex(u.Block,'NATIVE_FIVE_LANE_CATALOG_DIGEST'):
            u.prepare_native_five_lane_journal(manifest,
                {'catalog.json':raw+b' '},{})
    def test_expected_unit_and_host_are_one_existing_service(self):
        self.assertEqual(u.UNIT,'asi-strigunov-agent.service')
        self.assertEqual(u.HOST,'pqukibofpo')
        self.assertEqual(len(u.REQUIRED_NATIVE),4)
        self.assertIn('reconcile-pr564-pr565-no-replay',u.ACTIONS)
    def test_reads_both_terminal_and_both_waiting_reports(self):
        with tempfile.TemporaryDirectory(prefix='asi-upgrade-fixture-') as d:
            root=Path(d);root.chmod(0o700);setup(root)
            fake=mock.Mock(pw_uid=os.getuid(),pw_gid=os.getgid())
            with mock.patch.object(u,'STATE',root),mock.patch.object(u.pwd,'getpwnam',return_value=fake):
                out=u.current_state()
                self.assertEqual(len([x for x in out if x.startswith('reports/')]),4)
                self.assertEqual(len(out),12)
                self.assertEqual(len(set(out)),len(out))
    def test_unknown_durable_state_file_rejects_upgrade(self):
        with tempfile.TemporaryDirectory(prefix='asi-upgrade-fixture-') as d:
            root=Path(d);root.chmod(0o700);setup(root)
            (root/'state'/'unknown-intent.json').write_text('{}')
            fake=mock.Mock(pw_uid=os.getuid(),pw_gid=os.getgid())
            with mock.patch.object(u,'STATE',root),mock.patch.object(u.pwd,'getpwnam',return_value=fake):
                with self.assertRaisesRegex(u.Block,'UNKNOWN_OR_MISSING_NATIVE_STATE_FILE'):
                    u.current_state()
    def test_in_flight_native_lock_blocks_read_and_apply(self):
        with tempfile.TemporaryDirectory(prefix='asi-upgrade-fixture-') as d:
            root=Path(d);root.chmod(0o700);setup(root)
            (root/'state'/'execution.lock').mkdir()
            fake=mock.Mock(pw_uid=os.getuid(),pw_gid=os.getgid())
            with mock.patch.object(u,'STATE',root),mock.patch.object(u.pwd,'getpwnam',return_value=fake):
                with self.assertRaisesRegex(u.Block,'UNKNOWN_IN_FLIGHT_NATIVE_LOCK'):
                    u.current_state()
    def test_native_atomic_exchange_preserves_both_generations(self):
        with tempfile.TemporaryDirectory(prefix='asi-upgrade-fixture-') as d:
            root=Path(d);root.chmod(0o700)
            a=root/'active';b=root/'candidate'
            a.mkdir();b.mkdir();(a/'old').write_text('old');(b/'new').write_text('new')
            u.exchange(a,b)
            self.assertEqual((a/'new').read_text(),'new')
            self.assertEqual((b/'old').read_text(),'old')
    def test_exclusive_snapshot_files_never_overwrite(self):
        with tempfile.TemporaryDirectory(prefix='asi-upgrade-fixture-') as d:
            root=Path(d);root.chmod(0o700);p=root/'archive'
            u.put_new(p,b'original')
            with self.assertRaises(FileExistsError):u.put_new(p,b'new')
            self.assertEqual(p.read_bytes(),b'original')
    def test_v2_complete_authority_inventory_is_explicit_and_includes_model_key(self):
        expected={'activation.json','catalog.json','reviews.json','fence.json',
            'standing-verifier-public.pem','standing-parent.json',
            'standing-child.json','standing-children-history.json',
            'standing-revocations.json','five-lane-goal.json',
            'five-lane-assessments.json','openai-api-key'}
        self.assertEqual(set(u.NEXT_PROTECTED_FILES),expected)
        self.assertEqual(len(set(u.NEXT_PROTECTED_FILES.values())),len(expected))
        self.assertTrue(all(v.startswith('active-next-') for v in
            u.NEXT_PROTECTED_FILES.values()))
    def test_missing_any_v2_owner_pinned_source_refuses_before_apply(self):
        records={name:(b'private-credential-test-only-012345' if name=='openai-api-key'
                 else (b'[1]\n' if name=='catalog.json' else
                       ('signed-test-'+name).encode()))
                 for name in u.NEXT_PROTECTED_FILES}
        expected={k:sha(v) for k,v in records.items()}
        catalog=records['catalog.json']
        original=u.regular
        def read(file,**kwargs):
            source=Path(file).name
            for name,asset in u.NEXT_PROTECTED_FILES.items():
                if asset==source:return records[name]
            raise AssertionError('UNEXPECTED_PROTECTED_READ')
        manifest={'catalogSha256':sha(catalog)}
        with mock.patch.object(u,'regular',side_effect=read):
            valid=u.load_next_protected_sources(
                {'nextProtectedSha256':expected},b'new',manifest,
                {'catalog.json':catalog},None)
            self.assertEqual(valid,records)
            for name in records:
                changed=dict(expected);changed[name]='0'*64
                with self.subTest(name=name),self.assertRaisesRegex(
                    u.Block,'NEXT_PROTECTED_FILE_NOT_SIGNED'):
                    u.load_next_protected_sources(
                        {'nextProtectedSha256':changed},b'new',manifest,
                        {'catalog.json':catalog},None)
            with self.assertRaisesRegex(u.Block,'NEXT_PROTECTED_INVENTORY_NOT_SIGNED'):
                u.load_next_protected_sources(
                    {'nextProtectedSha256':{k:v for k,v in expected.items()
                       if k!='openai-api-key'}},b'new',manifest,
                    {'catalog.json':catalog},None)
        self.assertIs(original,u.regular)
    def test_missing_signed_model_credential_cannot_be_admitted(self):
        records={name:(b'k' if name=='openai-api-key' else b'x'*40)
            for name in u.NEXT_PROTECTED_FILES}
        records['catalog.json']=b'[1]\n'
        signed={k:sha(v) for k,v in records.items()}
        def read(file,**kwargs):
            for name,source in u.NEXT_PROTECTED_FILES.items():
                if Path(file).name==source:return records[name]
            raise AssertionError('unexpected')
        with mock.patch.object(u,'regular',side_effect=read):
            with self.assertRaisesRegex(u.Block,'NEXT_MODEL_CREDENTIAL_INVALID'):
                u.load_next_protected_sources(
                    {'nextProtectedSha256':signed},b'new',
                    {'catalogSha256':sha(records['catalog.json'])},
                    {'catalog.json':records['catalog.json']},None)
    def test_preexisting_and_absent_protected_files_are_distinguished(self):
        existing='activation.json'
        def read(file,**kwargs):
            if Path(file).name==existing:return b'previous-root-owned-policy'
            raise FileNotFoundError
        with mock.patch.object(u,'regular',side_effect=read):
            out=u.existing_protected_before_exchange(
                {'activation.json':b'new','openai-api-key':b'new-secret'})
        self.assertEqual(out,{'activation.json':b'previous-root-owned-policy',
                              'openai-api-key':None})
    def test_root_signed_grant_without_root_fails_before_read(self):
        with mock.patch.object(u.os,'geteuid',return_value=993):
            with self.assertRaisesRegex(u.Block,'UPGRADE_ROOT_HOST_REQUIRED'):
                u.protected_admission(None,None,None,{},None,None,None,None)
    def test_apply_never_stops_service_when_preflight_denies(self):
        with mock.patch.object(u,'preflight',side_effect=u.Block('UNSIGNED_SCOPE')):
            with mock.patch.object(u,'run') as shell:
                with self.assertRaisesRegex(u.Block,'UNSIGNED_SCOPE'):
                    u.apply(Path('/tmp/unused'))
                shell.assert_not_called()
    def test_missing_native_module_does_not_pass_exact_source_gate(self):
        files={'scripts/global-dispatcher/task-intake.mjs',
          'scripts/strigunov4/execution-adapters/standing-request-guard.mjs'}
        self.assertFalse(all(x in files for x in u.REQUIRED_NATIVE))
if __name__=='__main__':
    unittest.main()
