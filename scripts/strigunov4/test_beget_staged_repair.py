"""Offline source-only safeguards for protected disabled staged-generation repair."""
import importlib.util
from pathlib import Path
from unittest import TestCase, main, mock
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import os
import hashlib
import json

PATH=Path(__file__).resolve().parent/'execution-adapters'/'beget-staged-repair.py'
SPEC=importlib.util.spec_from_file_location('beget_staged_repair',PATH)
R=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(R)
hashbytes=lambda v: hashlib.sha256(v).hexdigest()
OLD={'baseSha':'a'*40,'sourceSha':'1'*40,'unitSha256':'b'*64}
NEW={'baseSha':'c'*40,'sourceSha':'2'*40,'catalogSha256':'d'*64,'unitSha256':'b'*64}
OLD_RAW=b'old-exact-package'
NEW_RAW=b'new-exact-package'
NOW=1793450000000
def valid():
    return {'schema':R.SCHEMA,'host':R.HOST,'unit':R.UNIT,'actions':R.ACTIONS[:],
        'oldManifestSha256':hashbytes(OLD_RAW),
        'newManifestSha256':hashbytes(NEW_RAW),
        'oldBaseSha':OLD['baseSha'],'newBaseSha':NEW['baseSha'],
        'newSourceSha':NEW['sourceSha'],'newCatalogSha256':NEW['catalogSha256'],
        'unitSha256':NEW['unitSha256'],'repairScriptSha256':hashbytes(PATH.read_bytes()),
        'repairReviewHead':'a'*40,
        'sourceReviewSha256':'1'*64,'nativeIsolationSha256':'2'*64,
        'repairReviewSha256':'3'*64,
        'notBefore':NOW-1000,'expiresAt':NOW+5000}
class SourceOnlyRepairTests(TestCase):
    def check(self,value):
        R.scope(value,OLD_RAW,NEW_RAW,OLD,NEW,NOW)
    def test_owner_signed_scope_accepts_only_exact_two_generation_pair(self):
        self.check(valid())
    def test_old_and_new_manifest_widening_fails(self):
        for field,value in [('oldManifestSha256','f'*64),('newManifestSha256','f'*64),
                            ('oldBaseSha','f'*40),('newBaseSha','f'*40),
                            ('newSourceSha','f'*40),('newCatalogSha256','f'*64),
                            ('unitSha256','f'*64),('repairScriptSha256','f'*64),('repairReviewHead','f'*40)]:
            with self.subTest(field=field):
                with self.assertRaisesRegex(RuntimeError,'REPAIR_SIGNED_SCOPE'):
                    R.scope({**valid(),field:value},OLD_RAW,NEW_RAW,OLD,NEW,NOW)
    def test_altered_action_or_host_or_schema_denied(self):
        for field,value in [('actions',['repair-disabled-staged-runtime']),('host','wrong'),
                            ('unit','another.service'),('schema','asi.untrusted')]:
            with self.subTest(field=field):
                with self.assertRaisesRegex(RuntimeError,'REPAIR_SIGNED_SCOPE'):
                    self.check({**valid(),field:value})
    def test_missing_evidence_digest_denied(self):
        for field,value in [('sourceReviewSha256',''),('nativeIsolationSha256',None),
                            ('repairReviewSha256',''),('repairReviewSha256','x'*64)]:
            with self.subTest(field=field):
                with self.assertRaisesRegex(RuntimeError,'REPAIR_SIGNED_SCOPE'):
                    self.check({**valid(),field:value})
    def test_expired_future_or_long_permission_denied(self):
        for changed in [{'expiresAt':NOW},{'notBefore':NOW+1,'expiresAt':NOW+2},
                        {'expiresAt':NOW+14*86400000+1000}]:
            with self.subTest(change=changed):
                with self.assertRaisesRegex(RuntimeError,'REPAIR_SIGNED_SCOPE'):
                    self.check({**valid(),**changed})
    def test_mismatched_unit_requires_separate_release(self):
        change={**NEW,'unitSha256':'c'*64}
        with self.assertRaisesRegex(RuntimeError,'REPAIR_UNIT_CHANGE_REQUIRES_DIFFERENT_RELEASE'):
            R.scope({**valid(),'unitSha256':'c'*64},OLD_RAW,NEW_RAW,OLD,change,NOW)
    def test_independent_exact_repair_review_is_required_before_any_state_change(self):
        with TemporaryDirectory(prefix='asi-repair-review-contract-') as directory:
            folder=Path(directory)
            script_hash=hashbytes(PATH.read_bytes())
            review={'schema':'asi.beget-staged-repair-review.v1','result':'PASS',
                'independent':True,'findings':0,'reviewedPr':559,
                'reviewedHead':'a'*40,
                'protectedBaseSha':NEW['baseSha'],'repairScriptSha256':script_hash}
            record=folder/'repair-review.json'
            record.write_text(json.dumps(review))
            payloads={
                'source-review.json':b'{"result":"PASS"}',
                'native-isolation.json':json.dumps({'host':R.HOST,
                   'unitSha256':NEW['unitSha256'],
                   'bwrapSha256':'e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71',
                   'result':'PASS','networkDenied':True,
                   'authorityInaccessible':True}).encode(),
                'repair-review.json':record.read_bytes()}
            grant=valid()
            grant['sourceReviewSha256']=hashbytes(payloads['source-review.json'])
            grant['nativeIsolationSha256']=hashbytes(payloads['native-isolation.json'])
            grant['repairReviewSha256']=hashbytes(payloads['repair-review.json'])
            class Reader:
                BWRAP_SHA='e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'
                def regular_bytes(self,path,root=False):
                    return payloads[Path(path).name]
                def source_review_preclaim(self,raw,new):
                    if raw.get('result')!='PASS':raise RuntimeError('REVIEW')
            with mock.patch.object(R,'AUTH',folder):
                R.independent_evidence(Reader(),grant,NEW)
                for change in [{'independent':False},{'result':'FAIL'},
                               {'reviewedPr':558},{'reviewedHead':'f'*40},{'repairScriptSha256':'f'*64},
                               {'protectedBaseSha':'f'*40},{'findings':1}]:
                    bad={**review,**change}
                    payloads['repair-review.json']=json.dumps(bad).encode()
                    grant['repairReviewSha256']=hashbytes(payloads['repair-review.json'])
                    with self.subTest(change=change):
                        with self.assertRaisesRegex(RuntimeError,'REPAIR_SOURCE_REVIEW_REQUIRED'):
                            R.independent_evidence(Reader(),grant,NEW)
    def test_root_ownership_required_before_any_package_read_or_write(self):
        with mock.patch.object(R.os,'geteuid',return_value=1000):
            with self.assertRaisesRegex(RuntimeError,'REPAIR_ROOT_HOST_REQUIRED'):
                R.apply(Path('/tmp/not-a-package'))
    def test_stopped_requires_exact_disabled_service_and_no_dropins(self):
        ok={'LoadState':'loaded','ActiveState':'inactive','MainPID':'0',
            'UnitFileState':'disabled','FragmentPath':str(R.SERVICE),
            'DropInPaths':'','User':'asi-engine','Group':'asi-engine'}
        class Fake:
            def __init__(self,data):self.data=data
            def call(self,args):
                return ''.join(f'{key}={value}\n' for key,value in self.data.items()).encode()
        self.assertEqual(R.stopped(Fake(ok)),ok)
        for changed in [{'ActiveState':'active'},{'MainPID':'42'},
                        {'DropInPaths':'/etc/systemd/system/example.d/override.conf'},
                        {'UnitFileState':'enabled'}]:
            with self.subTest(change=changed):
                with self.assertRaisesRegex(RuntimeError,'REPAIR_UNIT_NOT_DISABLED'):
                    R.stopped(Fake({**ok,**changed}))

class IsolatedAtomicRepairTests(TestCase):
    def run_repair(self,fail_receipt=False):
        with TemporaryDirectory(prefix='asi-repair-fixture-') as tempdir:
            t=Path(tempdir)
            engine=t/'opt'/'asi-engine';auth=t/'etc'/'asi';state=t/'state'
            engine.mkdir(parents=True);auth.mkdir(parents=True);state.mkdir()
            original=b'installed-old-content'
            (engine/'manifest.json').write_bytes(original)
            (engine/'node').write_bytes(b'fake-node')
            (engine/'bwrap').write_bytes(b'fake-bwrap')
            (auth/'owner-public.pem').write_bytes(b'inert-owner-key')
            (auth/'repair-approval.json').write_bytes(b'inert-signed-envelope-fixture')
            (state/'durable-ledger.json').write_bytes(b'{"spent":"never-refund"}')
            newraw=NEW_RAW
            files={'scripts/strigunov4/unit.mjs':b'export const unit = true;\\n',
                'beget-install.py':b'fixture-installer'}
            grant=valid()
            grant['oldManifestSha256']=hashbytes(original)
            class FakeInstaller:
                def prepared(self,package):return newraw,NEW,files
                def signed(self,name,public):
                    assert name=='repair-approval.json'
                    assert public==b'inert-owner-key'
                    return grant.copy()
                def regular_bytes(self,path,root=False,limit=2000000):
                    return Path(path).read_bytes()
                def write_new(self,path,data,mode=0o600):
                    path=Path(path)
                    if fail_receipt and path.name.startswith('repaired-stage-'):
                        raise OSError('fixture receipt write failure')
                    path.parent.mkdir(parents=True,exist_ok=True)
                    with path.open('xb') as out:out.write(data)
                    path.chmod(mode)
            backup=t/'opt'/('asi-engine-staged-backup-'+hashbytes(original)[:16])
            quarantine=t/'opt'/('.asi-engine-repair-failed-'+hashbytes(newraw)[:16])
            settings=[
                mock.patch.object(R,'ENGINE',engine),
                mock.patch.object(R,'STATE',state),
                mock.patch.object(R,'AUTH',auth),
                mock.patch.object(R,'BACKUP_ROOT',t/'opt'),
                mock.patch.object(R,'installer',return_value=FakeInstaller()),
                mock.patch.object(R,'old_generation',return_value=(original,OLD,b'inert-owner-key',{})),
                mock.patch.object(R,'stopped',return_value={}),
                mock.patch.object(R,'independent_evidence',return_value=None),
                mock.patch.object(R,'exact_main',return_value=None),
                mock.patch.object(R.os,'geteuid',return_value=0),
                mock.patch.object(R.os,'uname',return_value=SimpleNamespace(nodename=R.HOST)),
                mock.patch.object(R.time,'time',return_value=NOW/1000),
            ]
            for p in settings:p.start()
            try:
                if fail_receipt:
                    with self.assertRaisesRegex(OSError,'fixture receipt write failure'):
                        R.apply(t/'inert-package')
                else:
                    out=R.apply(t/'inert-package')
                    self.assertEqual(out['status'],'DISABLED_REPAIR_STAGE_ONLY')
                    self.assertTrue(out['needsSeparatelySignedActivation'])
                    self.assertEqual((engine/'manifest.json').read_bytes(),newraw)
                    self.assertEqual((engine.stat().st_mode & 0o777),0o755)
                    self.assertEqual((backup/'manifest.json').read_bytes(),original)
                    self.assertFalse(quarantine.exists())
                if fail_receipt:
                    self.assertEqual((engine/'manifest.json').read_bytes(),original)
                    self.assertTrue(quarantine.exists())
                    self.assertEqual((quarantine/'manifest.json').read_bytes(),newraw)
                    self.assertFalse(backup.exists())
                self.assertEqual((state/'durable-ledger.json').read_bytes(),b'{"spent":"never-refund"}')
                claim=auth/('repair-claim-'+hashbytes(original)+'-'+hashbytes(newraw)+'.json')
                self.assertTrue(claim.exists())
                self.assertTrue(json.loads(claim.read_text())['oneUse'])
            finally:
                for patch in reversed(settings):patch.stop()

    def test_disabled_staged_repair_atomic_swap_preserves_state_and_backup(self):
        self.run_repair(fail_receipt=False)

    def test_receipt_failure_rolls_back_and_consumes_one_use_claim(self):
        self.run_repair(fail_receipt=True)

if __name__=='__main__':main()
