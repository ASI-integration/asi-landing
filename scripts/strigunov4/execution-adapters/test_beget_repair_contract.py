"""Fail-closed source-only contract tests: no root, GitHub writes or service."""
import copy
import importlib.util
import pathlib
import unittest

FILE = pathlib.Path(__file__).with_name("beget_repair_contract.py")
spec = importlib.util.spec_from_file_location("repair_contract", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
D = lambda c: c * 64
S = lambda c: c * 40

def fixture():
    old = dict(schema="asi.beget-engine-source.v1", manifestSha256=D("a"),
               baseSha=S("1"), sourceSha=S("2"), catalogSha256=D("b"),
               unitSha256=D("c"))
    new = dict(schema="asi.beget-engine-source.v1", manifestSha256=D("d"),
               baseSha=S("3"), sourceSha=S("3"), catalogSha256=D("e"),
               unitSha256=D("c"))
    paths = [
        "/var/lib/asi-engine",
        "/opt/asi-engine/manifest.json",
        "/etc/asi-github-engine/stage-claim-"+D("a")+".json",
        "/etc/asi-github-engine/staged-isolation-"+D("a")+".json",
    ]
    p = dict(schema=m.SCHEMA, repository=m.REPO, host=m.HOST,
             unit=m.UNIT, serviceUser=m.USER, notBefore=1000,
             expiresAt=1000 + m.MAX_LEASE_MS, oneUse=True, nonce=D("f"),
             actions=m.STAGE_ONLY_ACTIONS.copy(), oldManifestSha256=D("a"),
             oldBaseSha=S("1"), oldSourceSha=S("2"), oldCatalogSha256=D("b"),
             newManifestSha256=D("d"), newBaseSha=S("3"),
             newSourceSha=S("3"), newCatalogSha256=D("e"),
             unitSha256=D("c"), nativeIsolationSha256=D("4"),
             fenceSha256=D("5"), sourceReviewSha256=D("6"),
             preservePaths=paths, paidBudget=0, startService=False)
    host = dict(LoadState="loaded", ActiveState="inactive",
                UnitFileState="disabled", MainPID="0", DropInPaths="",
                User=m.USER, Group=m.USER, InvocationID="")
    return p, old, new, S("3"), host, 1001

class RepairContractTests(unittest.TestCase):
    def test_structural_success_still_never_authorizes(self):
        result = m.validate_repair_contract(*fixture())
        self.assertEqual(result["status"], "STRUCTURAL_PREFLIGHT_ONLY")
        self.assertIs(result["authorized"], False)
        self.assertIs(result["safeToRepair"], False)
        self.assertIs(result["safeToActivate"], False)

    def test_unknown_approval_flag_is_rejected(self):
        x = list(fixture()); x[0]["signatureVerified"] = True
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_cannot_reuse_old_manifest(self):
        x = list(fixture())
        x[0]["newManifestSha256"] = x[0]["oldManifestSha256"]
        x[2]["manifestSha256"] = x[0]["oldManifestSha256"]
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_current_main_drift_denied(self):
        x = list(fixture()); x[3] = S("9")
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_unsupported_unit_upgrade_denied(self):
        x = list(fixture()); x[2]["unitSha256"] = D("9")
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_expired_or_future_or_long_grant_denied(self):
        for action in ("expired","future","long","bool"):
            with self.subTest(action=action):
                x = list(fixture())
                if action == "expired": x[5] = x[0]["expiresAt"]
                if action == "future": x[5] = 999
                if action == "long": x[0]["expiresAt"] += 1
                if action == "bool": x[0]["notBefore"] = True
                with self.assertRaises(m.RepairContractError):
                    m.validate_repair_contract(*x)

    def test_service_active_enabled_or_dropin_denied(self):
        for key, value in (("ActiveState","active"), ("UnitFileState","enabled"),
                           ("MainPID","999"), ("DropInPaths","/tmp/override.conf"),
                           ("InvocationID","unverified")):
            with self.subTest(key=key):
                x = list(fixture()); x[4][key] = value
                with self.assertRaises(m.RepairContractError):
                    m.validate_repair_contract(*x)

    def test_history_preservation_mandatory(self):
        x = list(fixture()); x[0]["preservePaths"].pop()
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_start_or_paid_budget_never_in_scope(self):
        for key,value in (("startService",True), ("paidBudget",1), ("paidBudget",False)):
            with self.subTest(key=key,value=value):
                x = list(fixture()); x[0][key] = value
                with self.assertRaises(m.RepairContractError):
                    m.validate_repair_contract(*x)

    def test_wrong_catalog_or_branch_identity_denied(self):
        for key,value in (("newCatalogSha256",D("f")), ("newSourceSha",S("f")),
                          ("oldBaseSha",S("0"))):
            with self.subTest(key=key):
                x = list(fixture()); x[0][key] = value
                with self.assertRaises(m.RepairContractError):
                    m.validate_repair_contract(*x)

    def test_mutated_actions_rejected(self):
        x = list(fixture()); x[0]["actions"].append("enable-start-engine")
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_invalid_nonce_or_input_types_denied(self):
        for bad in (123, "NotARealNonce", "z"*64):
            with self.subTest(bad=bad):
                x = list(fixture()); x[0]["nonce"] = bad
                with self.assertRaises(m.RepairContractError):
                    m.validate_repair_contract(*x)
        x = list(fixture()); x[4] = []
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

if __name__ == "__main__":
    unittest.main()
