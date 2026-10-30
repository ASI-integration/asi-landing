"""Offline source-only safeguards for protected disabled staged-generation repair."""
import importlib.util
from pathlib import Path
from unittest import TestCase, main, mock
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
        'sourceReviewSha256':'1'*64,'nativeIsolationSha256':'2'*64,
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
                            ('unitSha256','f'*64),('repairScriptSha256','f'*64)]:
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
        for field,value in [('sourceReviewSha256',''),('nativeIsolationSha256',None)]:
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
if __name__=='__main__':main()
