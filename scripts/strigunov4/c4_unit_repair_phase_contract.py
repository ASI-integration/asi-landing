"""Source-only OLD-to-NEW unit transition checks; NOT server authorization.

No I/O, CLI, service control, GitHub workflow or staging integration.
The caller must obtain trustworthy receipts and snapshots through a distinct
owner-approved and independently reviewed protected host adapter. A dictionary
supplied by an untrusted caller is NOT authority to repair anything.
"""
import c4_unit_contract as c

RECEIPT_SOURCE = "af468d85c8eaf308796bbdbb29b60a59270c45eb"
RECEIPT_RUN = "39261951787"
OLD = c.OLD_UNIT_SHA256
NEW = "6e0ce12922e015738368c89deeef154c195f19b2a0678d72d27d58e5414bf62c"
SNAPSHOT_KEYS = frozenset(("unitSha256", "environmentFiles",
                           "processToken", "otherStateToken", "noSend", "health"))


def verified_receipt(value):
    """Require the proven one-byte plan and exact consumed read-run identity."""
    c.validate_receipt(value, RECEIPT_SOURCE, RECEIPT_RUN)
    c.require(value["beforeSha256"] == OLD and value["afterSha256"] == NEW, "OLD_HASH")
    c.require(value["unitBytes"] == 454 and value["removedBytes"] == 1
              and value["planState"] == "REMOVE_ONE_OPTIONAL_BYTE"
              and value["environmentFiles"] == "EXACT_EXPECTED_OPTIONAL"
              and value["needDaemonReload"] == "no"
              and value["process"] == "STABLE_ACROSS_TWO_READS", "VALUE")
    return value


def phase(snapshot, expected):
    """Validate an independently supplied fixed-field host witness, not its source."""
    c.require(type(snapshot) is dict and set(snapshot) == SNAPSHOT_KEYS, "IDENTITY")
    c.require(expected in ("OLD", "NEW"), "ARGS")
    correct = (OLD, "optional") if expected == "OLD" else (NEW, "mandatory")
    c.require(type(snapshot["unitSha256"]) is str
              and type(snapshot["environmentFiles"]) is str
              and (snapshot["unitSha256"], snapshot["environmentFiles"]) == correct,
              "IDENTITY")
    c.require(type(snapshot["noSend"]) is bool and snapshot["noSend"] is True
              and type(snapshot["health"]) is bool and snapshot["health"] is True, "IDENTITY")
    for key in ("processToken", "otherStateToken"):
        c.require(type(snapshot[key]) is str and c.HEX.fullmatch(snapshot[key]), "IDENTITY")
    return snapshot


def transition(receipt, before, after):
    """Prove OLD+optional->NEW+mandatory without using NEW-only normal preflight."""
    verified_receipt(receipt)
    phase(before, "OLD")
    phase(after, "NEW")
    c.require(before["processToken"] == after["processToken"]
              and before["otherStateToken"] == after["otherStateToken"],
              "PROCESS_CHANGED")
    return "OFFLINE_PHASE_CONTRACT_PASS"


if __name__ == "__main__":
    raise SystemExit("OFFLINE_PHASE_CONTRACT_ONLY_NO_SERVER_AUTHORITY")
