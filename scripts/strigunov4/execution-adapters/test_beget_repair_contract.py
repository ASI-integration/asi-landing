"""Source-only staged-generation repair contract tests. Never an install grant."""
import hashlib
import importlib.util
import json
import pathlib
import unittest

FILE = pathlib.Path(__file__).with_name("beget_repair_contract.py")
spec = importlib.util.spec_from_file_location("repair_contract", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
D = lambda c: c * 64
S = lambda c: c * 40

def raw(m):
    return json.dumps(m, separators=(",", ":"), sort_keys=True).encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def fixture():
    old = dict(schema="asi.beget-engine-source.v1", baseSha=S("1"),
               sourceSha=S("2"), catalogSha256=D("b"), unitSha256=D("c"))
    new = dict(schema="asi.beget-engine-source.v1", baseSha=S("3"),
               sourceSha=S("3"), catalogSha256=D("e"), unitSha256=D("c"))
    old_raw, new_raw = raw(old), raw(new)
    old_hash, new_hash = digest(old_raw), digest(new_raw)
    paths = [
        "/var/lib/asi-engine",
        "/opt/asi-engine/manifest.json",
        "/etc/asi-github-engine/stage-claim-"+old_hash+".json",
        "/etc/asi-github-engine/staged-isolation-"+old_hash+".json",
    ]
    p = dict(schema=m.SCHEMA, repository=m.REPO, host=m.HOST,
             unit=m.UNIT, serviceUser=m.USER, notBefore=1000,
             expiresAt=1000 + m.MAX_LEASE_MS, oneUse=True, nonce=D("f"),
             actions=m.STAGE_ONLY_ACTIONS.copy(), oldManifestSha256=old_hash,
             oldBaseSha=S("1"), oldSourceSha=S("2"), oldCatalogSha256=D("b"),
             newManifestSha256=new_hash, newBaseSha=S("3"),
             newSourceSha=S("3"), newCatalogSha256=D("e"),
             unitSha256=D("c"), nativeIsolationSha256=D("4"),
             fenceSha256=D("5"), sourceReviewSha256=D("6"),
             preservePaths=paths, paidBudget=0, startService=False)
    host = dict(LoadState="loaded", ActiveState="inactive",
                UnitFileState="disabled", MainPID="0", DropInPaths="",
                User=m.USER, Group=m.USER, InvocationID="")
    return p, old_raw, new_raw, S("3"), host, 1001

class RepairContractTests(unittest.TestCase):
    def denied(self, x):
        with self.assertRaises(m.RepairContractError):
            m.validate_repair_contract(*x)

    def test_structural_success_still_never_authorizes(self):
        result = m.validate_repair_contract(*fixture())
        self.assertEqual(result["status"], "STRUCTURAL_PREFLIGHT_ONLY")
        for key in ("authorized", "safeToRepair", "safeToActivate"):
            self.assertIs(result[key], False)

    def test_unknown_approval_flag_cannot_authenticate(self):
        x = list(fixture()); x[0]["signatureVerified"] = True
        self.denied(x)

    def test_cannot_reuse_old_manifest(self):
        x = list(fixture())
        x[0]["newManifestSha256"] = x[0]["oldManifestSha256"]
        self.denied(x)

    def test_current_main_drift_denied(self):
        x = list(fixture()); x[3] = S("9")
        self.denied(x)

    def test_unsupported_unit_upgrade_denied(self):
        x = list(fixture())
        obj = json.loads(x[2]); obj["unitSha256"] = D("9")
        x[2] = raw(obj); x[0]["newManifestSha256"] = digest(x[2])
        self.denied(x)

    def test_expired_or_future_or_long_or_bool_grant_denied(self):
        for action in ("expired","future","long","bool"):
            with self.subTest(action=action):
                x = list(fixture())
                if action == "expired": x[5] = x[0]["expiresAt"]
                if action == "future": x[5] = 999
                if action == "long": x[0]["expiresAt"] += 1
                if action == "bool": x[0]["notBefore"] = True
                self.denied(x)

    def test_service_active_enabled_or_dropin_denied(self):
        for key, value in (("ActiveState","active"), ("UnitFileState","enabled"),
                           ("MainPID","999"), ("DropInPaths","/tmp/override.conf"),
                           ("InvocationID","unverified")):
            with self.subTest(key=key):
                x = list(fixture()); x[4][key] = value
                self.denied(x)

    def test_history_preservation_mandatory(self):
        x = list(fixture()); x[0]["preservePaths"].pop()
        self.denied(x)

    def test_start_or_paid_budget_never_in_scope(self):
        for key,value in (("startService",True), ("paidBudget",1), ("paidBudget",False)):
            with self.subTest(key=key,value=value):
                x = list(fixture()); x[0][key] = value
                self.denied(x)

    def test_wrong_catalog_or_branch_identity_denied(self):
        for key,value in (("newCatalogSha256",D("f")), ("newSourceSha",S("f")),
                          ("oldBaseSha",S("0"))):
            with self.subTest(key=key):
                x = list(fixture()); x[0][key] = value
                self.denied(x)

    def test_mutated_actions_rejected(self):
        x = list(fixture()); x[0]["actions"].append("enable-start-engine")
        self.denied(x)

    def test_action_list_subclass_cannot_forge_comparison(self):
        class FakeActions(list):
            def __eq__(self, other): return True
        x = list(fixture()); x[0]["actions"] = FakeActions(["enable-start-engine"])
        self.denied(x)

    def test_nonce_invalid_and_input_types_denied(self):
        for bad in (123, "NotARealNonce", "z"*64):
            with self.subTest(bad=bad):
                x = list(fixture()); x[0]["nonce"] = bad
                self.denied(x)
        x = list(fixture()); x[4] = []
        self.denied(x)

    def test_changed_raw_bytes_rejected_even_with_same_meaning(self):
        x = list(fixture()); x[2] += b"\n"
        self.denied(x)

    def test_duplicate_manifest_json_key_rejected(self):
        x = list(fixture())
        x[2] = x[2][:-1] + b', "unitSha256": "' + D("c").encode() + b'"}'
        x[0]["newManifestSha256"] = digest(x[2])
        self.denied(x)

    def test_nonfinite_manifest_and_nonbytes_denied(self):
        x = list(fixture()); x[2] = b'{"schema":"asi.beget-engine-source.v1","x":NaN}'
        self.denied(x)
        x = list(fixture()); x[2] = "not raw bytes"
        self.denied(x)

if __name__ == "__main__":
    unittest.main()
