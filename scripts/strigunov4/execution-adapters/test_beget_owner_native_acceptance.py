"""Offline owner-controlled technical acceptance, no real signer or server writes."""
import copy
import hashlib
import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('asi_owner_native_upgrade',
    Path(__file__).with_name('beget-live-upgrade.py'))
u=importlib.util.module_from_spec(spec)
spec.loader.exec_module(u)

def h(data):
    return hashlib.sha256(data).hexdigest()

def sample():
    old=b'{"generation":"old"}\n'
    new=b'{"generation":"new"}\n'
    manifest={'sourceSha':'a'*40,'catalogSha256':'c'*64}
    hashes={'state/test'+str(i):h(('evidence'+str(i)).encode()) for i in range(8)}
    record={
      'schema':'asi.beget-owner-native-technical-acceptance.v1',
      'mode':'OWNER_SIGNED_TECHNICAL_ACCEPTANCE',
      'decision':'ACCEPT_EXACT_RELEASE_FOR_INSTALL',
      'host':u.HOST,'unit':u.UNIT,
      'sourceSha':manifest['sourceSha'],'manifestSha256':h(new),
      'oldManifestSha256':h(old),'catalogSha256':manifest['catalogSha256'],
      'oldStateDigests':hashes,'validationRunId':41200000000,
      'nativeFiveLaneAdmissionTested':True,
      'realModelBudgetGateTested':True,
      'restoreReplayProhibitionTested':True,
      'testEvidenceSha256':{
        'node':h(b'node'),'installer':h(b'python'),
        'serviceUidSandbox':h(b'sandbox')
      }
    }
    return old,new,manifest,hashes,record

def tap(n=79,pass_count=None,fail=0,skip=0,cancelled=0,todo=0):
    if pass_count is None:pass_count=n
    return ('TAP version 13\n1..%d\n# tests %d\n# pass %d\n# fail %d\n'
            '# cancelled %d\n# skipped %d\n# todo %d\n' %
            (n,n,pass_count,fail,cancelled,skip,todo)).encode()

class OwnerAcceptanceSourceTests(unittest.TestCase):
    def test_exact_signed_acceptance_scope_payload(self):
        old,new,manifest,hashes,record=sample()
        self.assertEqual(u.owner_native_acceptance_scope(record,old,new,manifest,hashes),record)
        for key,value in [
            ('sourceSha','f'*40),
            ('manifestSha256','1'*64),
            ('oldManifestSha256','1'*64),
            ('catalogSha256','2'*64),
            ('validationRunId',0),
            ('validationRunId',True),
            ('mode','INDEPENDENT_REVIEW_PASS'),
            ('decision','PASS'),
            ('nativeFiveLaneAdmissionTested',False),
            ('restoreReplayProhibitionTested',False),
            ('realModelBudgetGateTested',False),
            ('testEvidenceSha256',{'node':'a'*64}),
            ('oldStateDigests',{}),
            ('schema','asi.fake.review'),
        ]:
            bad=copy.deepcopy(record)
            bad[key]=value
            with self.subTest(key=key,value=str(value)[:40]):
                with self.assertRaisesRegex(u.Block,'OWNER_TECHNICAL_ACCEPTANCE_SCOPE'):
                    u.owner_native_acceptance_scope(bad,old,new,manifest,hashes)
    def test_original_old_state_digests_are_exactly_bound(self):
        old,new,manifest,hashes,record=sample()
        altered=dict(hashes);altered['state/test0']='f'*64
        with self.assertRaisesRegex(u.Block,'OWNER_TECHNICAL_ACCEPTANCE_SCOPE'):
            u.owner_native_acceptance_scope(record,old,new,manifest,altered)
    def test_native_node_test_proof_has_real_clean_tap_summary(self):
        self.assertTrue(u.native_owner_test_log_valid('node',tap()))
        for report in [tap(n=0),tap(n=8,pass_count=7,fail=1),
                       tap(n=8,pass_count=7,skip=1),
                       tap(n=8,pass_count=7,todo=1),
                       tap(n=8,pass_count=7,cancelled=1),
                       b'PASS',b'REVIEWED',tap()+tap(n=0)]:
            with self.subTest(report=report[-60:]):
                with self.assertRaises(u.Block):
                    u.native_owner_test_log_valid('node',report)
    def test_host_sandbox_requires_service_uid_no_new_privileges_and_unshare(self):
        marker=b'ENGINE_UID=asi-engine\nNO_NEW_PRIVS=yes\nNETWORK_UNSHARE=all\nBWRAP_RESULT=0\n'
        self.assertTrue(u.native_owner_test_log_valid(
            'serviceUidSandbox',marker+tap(n=15)))
        for content in [marker+tap(n=9),marker.replace(b'yes',b'no')+tap(n=15),
                        marker.replace(b'asi-engine',b'root')+tap(n=15),
                        marker.replace(b'all',b'host')+tap(n=15),
                        marker.replace(b'BWRAP_RESULT=0',b'BWRAP_RESULT=1')+tap(n=15)]:
            with self.assertRaises(u.Block):
                u.native_owner_test_log_valid('serviceUidSandbox',content)
    def test_installer_proof_requires_seventeen_real_succeeding_tests(self):
        report=b'.................\n----\nRan 17 tests in 0.041s\n\nOK\n'
        self.assertTrue(u.native_owner_test_log_valid('installer',report))
        for bad in [report.replace(b'17 tests',b'16 tests'),
                    report.replace(b'OK',b'FAILED (errors=1)'),
                    b'OK',b'REVIEWER PASS']:
            with self.assertRaises(u.Block):
                u.native_owner_test_log_valid('installer',bad)

if __name__=='__main__':
    unittest.main()
