"""Pure local pin diff, pending a real protected unit receipt. No file writes."""
import c4_unit_contract as c

BASE_SHA = "1582d42dd18daabea21260a09d8bc814276de651"
ACTIVE = {
    "scripts/strigunov4/staging_no_send_host.py": "47a28c91608303c1f90f01d94fab21064ae8dc6423927c41b65c23ee5c3bcf7b",
    "scripts/strigunov4/c4_staging_readonly_probe.py": "fd69b6da1bb789304401549e2e37aba205c5116450d672690b03e0d324cfb117",
    "scripts/strigunov4/protected_staging_host_probe.py": "88ff94b04dd126468f172edcfeb66ed1b7c8e9ece5ac01d1bc3a2e02f70dee12",
    "scripts/strigunov4/g0_activation_host.py": "f3c9b9c313d0cbe5dd5afb0cf029a2174fa2a545310ce85df041efca459550ee",
}
HISTORICAL = "scripts/strigunov4/candidates/systemd_candidate.py"
HISTORICAL_SHA256 = "986a0a0d794af465c7763d6ae1de0b6b2f142e427d225cceda4d666803c80d05"


def plan(files, receipt, source_sha, run_id):
    """Caller must retain actual run/job/log provenance; JSON is not approval."""
    c.validate_receipt(receipt, source_sha, run_id)
    c.require(receipt["planState"] == "REMOVE_ONE_OPTIONAL_BYTE", "VALUE")
    c.require(set(files) == set(ACTIVE) | {HISTORICAL}, "PATH")
    c.require(c.digest(files[HISTORICAL]) == HISTORICAL_SHA256, "OLD_HASH")
    new = receipt["afterSha256"].encode()
    old = c.OLD_UNIT_SHA256.encode()
    result = {}
    for path, expected in ACTIVE.items():
        raw = files[path]
        c.require(type(raw) is bytes and c.digest(raw) == expected and raw.count(old) == 1, "OLD_HASH")
        result[path] = raw.replace(old, new, 1)
        c.require(len(result[path]) == len(raw) and result[path].count(new) == 1, "VALUE")
    # No history/candidate fixture hashes are changed or regenerated.
    result[HISTORICAL] = files[HISTORICAL]
    return result


if __name__ == "__main__":
    raise SystemExit("LOCAL_PLAN_ONLY_REQUIRES_REAL_RECEIPT")
