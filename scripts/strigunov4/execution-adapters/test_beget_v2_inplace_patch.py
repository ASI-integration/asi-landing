"""Tests: V2 hotpatch cannot reset original task/model budgets or authority."""
import copy
import importlib.util
import pathlib
import unittest
p=pathlib.Path(__file__).with_name('beget-v2-inplace-patch.py')
s=importlib.util.spec_from_file_location('asi_beget_v2_patch_source',p)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
ONE='1'*64
TWO='2'*64
BASE='a'*40
MOD='scripts/strigunov4/execution-adapters/publication-loop.mjs'
def manifest():
    files=[{'path':f'scripts/strigunov4/test-{i}.mjs','sha256':ONE} for i in range(35)]
    files.append({'path':MOD,'sha256':ONE})
    return {'schema':'asi.beget-engine-source.v1','baseSha':BASE,
        'catalogSha256':ONE,'unitSha256':ONE,'nodeSha256':ONE,
        'bwrapSha256':ONE,'nativeFiveLaneWiring':
            'OWNER_SIGNED_TECHNICAL_ACCEPTANCE_V1','files':files}
def activation():
    return {'schema':'asi.engine-beget-five-lane-activation.v1',
            'repo':'ASI-integration/asi-landing','baseSha':BASE,
            'runtimeManifestSha256':ONE,
            'model':{'name':'gpt-4.1-mini','reviewName':'gpt-4.1',
               'maxCalls':18,'maxPaidMicrousd':1800000}}
def ledger(a):
    return {'mode':'IDLE','jobs':{'old-564':{},'old-565':{}},
         'reconciledFailedLocked':{'priorMode':'FAILED_LOCKED'},
         'ownerLaneJournal':{'lanes':{k:{'mode':'READY'} for k in
             ('engine','ru-auth','p0-integration','p0-trust','p0-atomic-budget')}},
         'modelReservationBudget':{'version':1,
            'policySha256':m.model_hash(a),'spentMicrousd':100000,
            'claims':[{'taskId':'asi-engine-groundzero-01',
              'model':'gpt-4.1-mini','pathDigest':TWO,
              'operationId':'model-1','microusd':100000}]}}
class TestV2(unittest.TestCase):
    def test_source_patch_is_exactly_allowlisted(self):
        x=manifest();y=copy.deepcopy(x)
        y['files'][-1]['sha256']=TWO
        self.assertEqual(m.old_new_files(x,y),[MOD])
    def test_empty_patch_rejected(self):
        a=manifest()
        with self.assertRaises(m.Denied):m.old_new_files(a,copy.deepcopy(a))
    def test_catalog_change_rejected(self):
        a=manifest();b=copy.deepcopy(a);b['catalogSha256']=TWO
        with self.assertRaises(m.Denied):m.old_new_files(a,b)
    def test_new_unapproved_file_rejected(self):
        a=manifest();b=copy.deepcopy(a)
        b['files'].append({'path':'scripts/strigunov4/foreign.mjs','sha256':TWO})
        with self.assertRaises(m.Denied):m.old_new_files(a,b)
    def test_unreviewed_changed_module_rejected(self):
        a=manifest();b=copy.deepcopy(a)
        b['files'][0]['sha256']=TWO
        with self.assertRaises(m.Denied):m.old_new_files(a,b)
    def test_budget_and_all_five_lanes_survive(self):
        a=activation();b=copy.deepcopy(a);b['runtimeManifestSha256']=TWO
        before=ledger(a);snapshot=copy.deepcopy(before)
        after=m.preserve_ledger(before,a,b)
        self.assertEqual(before,snapshot)
        self.assertEqual(after['modelReservationBudget']['claims'],
                         before['modelReservationBudget']['claims'])
        self.assertEqual(after['modelReservationBudget']['spentMicrousd'],100000)
        self.assertEqual(after['ownerLaneJournal'],before['ownerLaneJournal'])
        self.assertEqual(after['jobs'],before['jobs'])
        self.assertEqual(after['modelReservationBudget']['policySha256'],
                         m.model_hash(b))
        self.assertNotEqual(after['modelReservationBudget']['policySha256'],
                            m.model_hash(a))
    def test_unknown_task_not_allowed(self):
        a=activation();t=ledger(a);t['nativeFiveLaneTask']={'status':'PENDING'}
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
    def test_spend_refund_not_allowed(self):
        a=activation();t=ledger(a);t['modelReservationBudget']['claims']=[]
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
    def test_replay_claim_not_allowed(self):
        a=activation();t=ledger(a)
        t['modelReservationBudget']['claims']*=2
        t['modelReservationBudget']['spentMicrousd']=200000
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
    def test_wrong_model_budget_policy_denied(self):
        a=activation();t=ledger(a);t['modelReservationBudget']['policySha256']=TWO
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
    def test_missing_ledger_reconciliation_denied(self):
        a=activation();t=ledger(a);del t['reconciledFailedLocked']
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
    def test_unknown_lane_denied(self):
        a=activation();t=ledger(a)
        t['ownerLaneJournal']['lanes']['engine']['mode']='UNKNOWN'
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
    def test_non_idle_denied(self):
        a=activation();t=ledger(a);t['mode']='FAILED_LOCKED'
        with self.assertRaises(m.Denied):m.preserve_ledger(t,a,a)
if __name__=='__main__':unittest.main()