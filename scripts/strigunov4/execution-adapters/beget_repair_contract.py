"""Source-only contract for a future ONE-USE Beget staged-generation repair.

Deliberately NOT imported by the live installer; never executes a repair, verifies
a signature, creates a receipt, or grants any authority. A protected integration
must independently authenticate the owner Ed25519 envelope and current provider,
native isolation and old-writer fence BEFORE and AGAIN at the one-use claim.
"""
import hashlib
import json
import re

SCHEMA = "asi.beget-staged-generation-repair-authorization.v1"
REPO = "ASI-integration/asi-landing"
HOST = "pqukibofpo"
UNIT = "asi-strigunov-agent.service"
USER = "asi-engine"
MAX_LEASE_MS = 14 * 86400000
MAX_SAFE_INT = 9007199254740991
STAGE_ONLY_ACTIONS = [
    "verify-exact-old-disabled-generation",
    "verify-new-current-main-generation",
    "replace-root-owned-runtime-with-rollback-generation",
    "preserve-old-stage-claim-and-all-durable-state",
    "record-one-use-repair-receipt",
    "leave-engine-disabled-and-inactive",
]
KEYS = frozenset({
    "schema", "repository", "host", "unit", "serviceUser",
    "notBefore", "expiresAt", "oneUse", "nonce", "actions",
    "oldManifestSha256", "oldBaseSha", "oldSourceSha", "oldCatalogSha256",
    "newManifestSha256", "newBaseSha", "newSourceSha", "newCatalogSha256",
    "unitSha256", "nativeIsolationSha256", "fenceSha256",
    "sourceReviewSha256", "preservePaths", "paidBudget", "startService",
})

class RepairContractError(ValueError):
    pass

def _require(ok, code):
    if not ok:
        raise RepairContractError(code)

def _digest(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{64}", value) is not None

def _sha(value):
    return type(value) is str and re.fullmatch(r"[0-9a-f]{40}", value) is not None

def _integer(value):
    return type(value) is int and 0 <= value <= MAX_SAFE_INT

def _read_manifest(raw):
    _require(type(raw) is bytes and 0 < len(raw) <= 2000000, "REPAIR_RAW_MANIFEST")
    def no_duplicates(pairs):
        value = {}
        for key, item in pairs:
            _require(key not in value, "REPAIR_DUPLICATE_JSON_KEY")
            value[key] = item
        return value
    def reject_constant(value):
        raise RepairContractError("REPAIR_NONFINITE_JSON")
    try:
        manifest = json.loads(raw.decode("utf-8"), object_pairs_hook=no_duplicates,
                              parse_constant=reject_constant)
    except (ValueError, UnicodeError) as error:
        raise RepairContractError("REPAIR_BAD_JSON") from error
    _require(type(manifest) is dict, "REPAIR_MANIFEST")
    return manifest, hashlib.sha256(raw).hexdigest()

def validate_repair_contract(payload, old_raw, new_raw, current_main, observed, now):
    """Validate scope only. Return a permanently NON-AUTHORIZING receipt.

    All supplied values may be untrusted; a positive structural check is NOT
    permission. Callers cannot supply a signatureVerified/ownerApproval flag.
    The existing installer has no staged-generation repair operation.
    """
    _require(type(payload) is dict and set(payload) == KEYS, "REPAIR_SCHEMA_KEYS")
    _require(type(observed) is dict, "REPAIR_INPUTS")
    old, old_hash = _read_manifest(old_raw)
    new, new_hash = _read_manifest(new_raw)
    _require(payload["schema"] == SCHEMA and payload["repository"] == REPO and
             payload["host"] == HOST and payload["unit"] == UNIT and
             payload["serviceUser"] == USER and
             type(payload["oneUse"]) is bool and payload["oneUse"] is True and
             type(payload["actions"]) is list and
             payload["actions"] == STAGE_ONLY_ACTIONS and
             type(payload["paidBudget"]) is int and payload["paidBudget"] == 0 and
             type(payload["startService"]) is bool and payload["startService"] is False,
             "REPAIR_SCOPE")
    _require(_integer(now) and _integer(payload["notBefore"]) and
             _integer(payload["expiresAt"]) and
             payload["notBefore"] <= now < payload["expiresAt"] and
             0 < payload["expiresAt"] - payload["notBefore"] <= MAX_LEASE_MS and
             _digest(payload["nonce"]), "REPAIR_WINDOW")
    for name in ("oldManifestSha256", "oldCatalogSha256", "newManifestSha256",
                 "newCatalogSha256", "unitSha256", "nativeIsolationSha256",
                 "fenceSha256", "sourceReviewSha256"):
        _require(_digest(payload[name]), "REPAIR_DIGEST")
    for name in ("oldBaseSha", "oldSourceSha", "newBaseSha", "newSourceSha"):
        _require(_sha(payload[name]), "REPAIR_GIT_SHA")
    for side, m, manifest_hash in (("old", old, old_hash), ("new", new, new_hash)):
        _require(m.get("schema") == "asi.beget-engine-source.v1" and
                 manifest_hash == payload[side+"ManifestSha256"], "REPAIR_MANIFEST")
        for field, dest in (("manifestSha256", side+"ManifestSha256"),
                            ("catalogSha256", side+"CatalogSha256"),
                            ("baseSha", side+"BaseSha"),
                            ("sourceSha", side+"SourceSha")):
            _require(m.get(field) == payload[dest], "REPAIR_GENERATION_PIN")
        _require(m.get("unitSha256") == payload["unitSha256"],
                 "REPAIR_UNIT_DRIFT")
    _require(payload["oldManifestSha256"] != payload["newManifestSha256"] and
             payload["oldBaseSha"] != payload["newBaseSha"] and
             payload["newBaseSha"] == current_main and _sha(current_main),
             "REPAIR_MAIN_GENERATION")
    paths = [
        "/var/lib/asi-engine",
        "/opt/asi-engine/manifest.json",
        "/etc/asi-github-engine/stage-claim-"+payload["oldManifestSha256"]+".json",
        "/etc/asi-github-engine/staged-isolation-"+payload["oldManifestSha256"]+".json",
    ]
    _require(type(payload["preservePaths"]) is list and
             payload["preservePaths"] == paths, "REPAIR_PRESERVE_HISTORY")
    _require(observed == {
        "LoadState": "loaded", "ActiveState": "inactive",
        "UnitFileState": "disabled", "MainPID": "0",
        "DropInPaths": "", "User": USER, "Group": USER,
        "InvocationID": "",
    }, "REPAIR_HOST_NOT_DISABLED")
    return {
        "status": "STRUCTURAL_PREFLIGHT_ONLY",
        "authorized": False, "safeToRepair": False, "safeToActivate": False,
        "oldManifestSha256": payload["oldManifestSha256"],
        "newManifestSha256": payload["newManifestSha256"],
        "requiredNext": "INDEPENDENT_SIGNED_ROOT_REPAIR_GATE",
    }
