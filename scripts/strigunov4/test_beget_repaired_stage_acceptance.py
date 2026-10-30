"""Offline tests for repaired-stage admission: no real root access, no service start."""
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main, mock

PATH=Path(__file__).resolve().parent/'execution-adapters'/'beget-install.py'
SPEC=importlib.util.spec_from_file_location('asi_staged_admission',PATH)
I=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(I)
encode=lambda value:json.dumps(value,sort_keys=True,separators=(',',':')).encode('utf8')
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def json_bytes(value):return encode(value)

class RepairedAdmissionTests(TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory(prefix='asi-repaired-admission-')
        self.addCleanup(self.temp.cleanup)
        self.auth=Path(self.temp.name)/'authority'
        self.original_auth=I.AUTH
        I.AUTH=self.auth
        self.addCleanup(lambda:setattr(I,'AUTH',self.original_auth))
        self.old={'schema':'asi.beget-engine-source.v1','unitSha256':'b'*64,
                  'baseSha':'c'*40,'sourceSha':'d'*40}
        self.new={'schema':'asi.beget-engine-source.v1','unitSha256':'b'*64,
                  'baseSha':'e'*40,'sourceSha':'f'*40,'catalogSha256':'1'*64}
        self.oldraw=encode(self.old)
        self.newraw=encode(self.new)
        self.oh=sha(self.oldraw)
        self.nh=sha(self.newraw)
        self.backup=Path('/opt/asi-engine-staged-backup-'+self.oh[:16])
        self.grant={'schema':'asi.beget-staged-generation-repair.v1',
                    'host':I.HOST,'unit':I.UNIT,'oldManifestSha256':self.oh,
                    'newManifestSha256':self.nh,'oldBaseSha':self.old['baseSha'],
                    'newBaseSha':self.new['baseSha'],'newSourceSha':self.new['sourceSha'],
                    'newCatalogSha256':self.new['catalogSha256'],
                    'unitSha256':self.new['unitSha256'],
                    'actions':['repair-disabled-staged-runtime','preserve-state',
                               'preserve-original-generation','remain-disabled']}
        self.stage={'schema':I.STAGE_SCHEMA,'host':I.HOST,'unit':I.UNIT,
                    'manifestSha256':self.oh,'sourceSha':self.old['sourceSha'],
                    'baseSha':self.old['baseSha'],'unitSha256':self.old['unitSha256'],
                    'actions':I.STAGE_ACTIONS}
        self.grantbytes=encode({'signedEnvelopePlaceholder':'fixture-only'})
        self.claim={'oldManifestSha256':self.oh,'newManifestSha256':self.nh,'oneUse':True}
        self.receipt={'schema':'asi.beget-disabled-repaired-stage.v1',
                      'oldManifestSha256':self.oh,'newManifestSha256':self.nh,
                      'ownerGrantSha256':sha(self.grantbytes),'serviceStarted':False,
                      'originalBackup':str(self.backup)}
        self.prior={'schema':'asi.beget-staged-isolation.v1','manifestSha256':self.oh,
                    'unitSha256':self.old['unitSha256'],'nodeSha256':I.NODE_SHA,
                    'bwrapSha256':I.BWRAP_SHA,'uid':1234}
        self.original_claim={'manifestSha256':self.oh,'oneUse':True}
        self.bytes={
            self.auth/('repaired-stage-'+self.nh+'.json'):encode(self.receipt),
            self.auth/('repair-claim-'+self.oh+'-'+self.nh+'.json'):encode(self.claim),
            self.auth/'repair-approval.json':self.grantbytes,
            self.backup/'manifest.json':self.oldraw,
            self.auth/('staged-isolation-'+self.oh+'.json'):encode(self.prior),
            self.auth/('stage-claim-'+self.oh+'.json'):encode(self.original_claim),
        }
        self.bound={'oldManifestSha256':self.oh,
                    'receiptSha256':sha(self.bytes[self.auth/('repaired-stage-'+self.nh+'.json')]),
                    'claimSha256':sha(self.bytes[self.auth/('repair-claim-'+self.oh+'-'+self.nh+'.json')]),
                    'repairGrantSha256':sha(self.grantbytes)}
        self.permit={'repairedStage':self.bound}
        self._mocks=[
            mock.patch.object(I,'regular_bytes',side_effect=self.read),
            mock.patch.object(I,'signed',side_effect=self.signed),
            mock.patch.object(I,'verified_staged_runtime',return_value='verified_uid_1234')
        ]
        for patch in self._mocks:patch.start()
        self.addCleanup(lambda:[patch.stop() for patch in reversed(self._mocks)])
    def read(self,p,*args,**kwargs):
        if Path(p) not in self.bytes:raise I.Block('FIXTURE_MISSING')
        return self.bytes[Path(p)]
    def signed(self,name,public):
        if name=='repair-approval.json':return self.grant
        if name=='stage-approval.json':return self.stage
        raise I.Block('UNKNOWN_SIGNED_FIXTURE')
    def check(self):
        return I.repaired_stage_state(self.newraw,self.new,{},b'owner-public-key',self.permit)

    def test_positive_explicit_owner_bound_repair_uses_existing_install_authority(self):
        self.assertEqual(self.check(),'verified_uid_1234')
        self.assertEqual(I.stage_admission(self.newraw,self.new,{},b'owner-public-key',
                                           self.permit,1000),'verified_uid_1234')
    def test_no_repair_binding_does_not_silently_use_repair_receipt(self):
        with mock.patch.object(I,'staged_state',side_effect=I.Block('OLD_STAGE_NOT_NEW')):
            with self.assertRaisesRegex(I.Block,'OLD_STAGE_NOT_NEW'):
                I.stage_admission(self.newraw,self.new,{},b'owner-public-key',{},1000)
    def test_reject_partial_or_unknown_admission_fields(self):
        self.permit['repairedStage']={'oldManifestSha256':self.oh}
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_ADMISSION'):self.check()
    def test_reject_reused_old_manifest_as_new(self):
        self.permit['repairedStage']['oldManifestSha256']=self.nh
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_BINDING'):self.check()
    def test_reject_replaced_receipt_bytes(self):
        key=self.auth/('repaired-stage-'+self.nh+'.json')
        self.bytes[key]=encode(dict(self.receipt,serviceStarted=True))
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_EVIDENCE_CHANGED'):self.check()
    def test_reject_receipt_claiming_engine_started_even_with_matching_hash(self):
        key=self.auth/('repaired-stage-'+self.nh+'.json')
        self.bytes[key]=encode(dict(self.receipt,serviceStarted=True))
        self.bound['receiptSha256']=sha(self.bytes[key])
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_RECEIPT_OR_CLAIM'):self.check()
    def test_reject_replayed_or_missing_repair_claim(self):
        key=self.auth/('repair-claim-'+self.oh+'-'+self.nh+'.json')
        self.bytes[key]=encode(dict(self.claim,oneUse=False))
        self.bound['claimSha256']=sha(self.bytes[key])
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_RECEIPT_OR_CLAIM'):self.check()
    def test_reject_wrong_original_manifest(self):
        self.bytes[self.backup/'manifest.json']=b'altered-old-generation'
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_ORIGINAL_MISSING'):self.check()
    def test_reject_changed_historic_stage_receipt(self):
        key=self.auth/('staged-isolation-'+self.oh+'.json')
        self.bytes[key]=encode(dict(self.prior,uid=0))
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_PRIOR_EVIDENCE'):self.check()
    def test_reject_misbound_historical_signed_stage(self):
        self.stage['manifestSha256']=self.nh
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_OLD_GRANT'):self.check()
    def test_reject_repair_grant_mismatch(self):
        self.grant['newSourceSha']='0'*40
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_REPAIR_GRANT'):self.check()
    def test_reject_repair_grant_without_same_backup_unit(self):
        self.old['unitSha256']='8'*64
        self.oldraw=encode(self.old)
        self.bytes[self.backup/'manifest.json']=self.oldraw
        # Old digest must be pinned. Any changed old manifest is rejected.
        with self.assertRaisesRegex(I.Block,'REPAIRED_STAGE_ORIGINAL_MISSING'):self.check()

if __name__=='__main__':main()
