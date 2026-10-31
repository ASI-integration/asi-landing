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
class RealUpgradeSourceTests(unittest.TestCase):
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
