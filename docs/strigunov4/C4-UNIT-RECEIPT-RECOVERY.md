# C4 unit receipt recovery after run 39235934084

## Boundary and evidence

This package prepares a distinct, single-use read procedure. It neither applies
the unit repair nor authorizes a dispatch. Publication, merge, and a later
protected dispatch require the corresponding owner permissions. Never rerun
`strigunov4-c4-unit-readonly.yml` or run 39235934084.

Base: `fe205de63bf23159fd6872ebe078548458fbc9cd`. The preceding run
[39235934084](https://github.com/ASI-integration/asi-landing/actions/runs/39235934084)
completed successfully on that SHA, attempt 1. Its only retained receipt was
in logs; GitHub masked part of `afterSha256`, and the run has no artifacts.
The masked value is not a usable hash. Do not reconstruct the masked segment,
change masks, encode the hash, split it, or expose the original unit.

The saved receipt establishes 454 source bytes, one planned byte removal,
`EXACT_EXPECTED_OPTIONAL`, `needDaemonReload=no`, stable process across two
reads, and this exact original SHA256:

`9072dd1a276c7bea2bb7d17031a51b250177e2806cd632e26728028c0a8a01d9`

The full new SHA256 remains **UNKNOWN**. No matching original bytes were found
in the scoped local file/archive/Git/literal search. The new reader retains
the exact original hash pin. It accepts no caller-supplied unit, path, old hash
or transformation. Existing `c4_unit_contract.plan` removes the actual one
optional `-` byte and preserves every other byte; 454 becomes 453.

`historicalWrite=UNKNOWN` and `replayAllowed=false` remain mandatory. An absent
claim does not prove there were no historical writes. This is not pilot acceptance.

## Existing approved recipient; no private key in GitHub

Use only the repository public certificate `scripts/strigunov4/backup-recipient.crt`:

* Subject: `CN=ASI-Strigunov4-Backup-2026`, RSA 3072.
* X.509 DER SHA256: `6afa982f3e0737e1567e13bfdb858d9eef00ede86b481a69d758a7f3e107a733`.
* Existing owner custody evidence: backup run 38919293685 and
  `docs/strigunov4/RESTORE-EXECUTION-RESULT.md` / `RESTORE-EXECUTION-PLAN.md`.
  The owner previously decrypted that backup locally; the private key remained
  on Windows. Current local certificate fingerprint matches the repository.
* Local key metadata was checked, not its contents. The private key remains
  outside GitHub. Do not add it to secrets, workflow inputs, artifacts or logs.

Before any future dispatch, the owner's permission must identify this recipient
and confirm continued local key custody. Do not substitute a newly generated
recipient. Offline tests use disposable keys, never the owner's real key.

The encrypted envelope uses CMS AuthEnvelopedData, AES-256-GCM and RSA-OAEP with
SHA256/MGF1-SHA256. Existing backup CBC envelopes are not changed. The pinned
certificate, remaining validity, encryption support, and fresh output directory
are checked before contacting the server. The receipt is strictly validated in
memory, encrypted through stdin, and never written in plaintext on the runner.
Raw unit bytes never leave the existing remote reader.

## One new protected procedure

Workflow: `.github/workflows/strigunov4-c4-unit-receipt-once.yml`.

After review and a separately authorized merge, determine the **actual new main
SHA**. Do not use the old base SHA as the future workflow source. Future inputs:

```
reviewed_main_sha=<ACTUAL_REVIEWED_MAIN_SHA>
confirm=READONLY_C4_UNIT_RECEIPT_<ACTUAL_REVIEWED_MAIN_SHA>
```

Required before one dispatch: explicit owner permission; current protected main
and exact source; no previous dispatch of this new workflow; no queued, running,
waiting, pending or requested other Actions runs; existing staging independent
approval unchanged. Never approve the environment on the owner's behalf.

The gate verifies the sole current new workflow dispatch, exact run identity,
owner, source and attempt 1. It also requires the sole old workflow dispatch to
be the completed successful run 39235934084 on the original SHA, attempt 1.
Deleting prior run evidence or disabling protections is not a recovery method.
The shared concurrency group is unchanged. The queue check covers every event,
because two existing protected staging workflows also accept push triggers.
Wait for a quiet Actions window before dispatch; do not cancel unrelated runs
or bypass approval to clear the gate. Main/history/queues are checked
again immediately before transport; the fixed SSH host key and checked-out SHA
are enforced by the existing transport. The remote payload remains byte-identical
to the old reader; no SQL, service control or server writes are introduced.

Any dispatched attempt consumes this procedure, including BLOCK, cancellation,
upload failure and interrupted connection. No rerun and no second dispatch.
If an encrypted artifact already exists after a late failure, recover that
artifact offline instead of contacting the server again.

## Durable receipt and offline verification

The workflow uploads exactly one file, `unit-receipt.cms`, under artifact name
`c4-unit-receipt-<RUN_ID>-1`. No wildcard directory, certificate, SSH key or
plaintext is uploaded. Upload fails on missing files and never overwrites.
Pinned upload/download actions are used. The workflow downloads the artifact
and requires exactly one regular file with byte-for-byte equality to the
locally encrypted file before SUCCESS. A false success after lost log output
therefore cannot recur through the same storage defect.

Artifacts still expire under repository retention. After the authorized run:

1. Read authenticated GitHub API metadata for the workflow run, attempt and
   artifact. Verify repository, workflow path, exact approved source SHA,
   branch, run ID, attempt 1, artifact ID/name, `expired=false`, one artifact,
   and the archive SHA256 digest. Save this provenance locally. Check job
   results; a failed run is not silently promoted to success.
2. Download the artifact by that exact ID over the authenticated GitHub route.
   Compare the **archive** SHA256 to the API artifact digest (do not compare
   an extracted file hash to the ZIP digest). Refuse missing digest, mismatched
   source/run, ambiguity, unexpected ZIP members, links or oversized members.
   Require exactly `unit-receipt.cms`, at most 16384 bytes; extract into a new
   private local directory. Keep the archive and provenance.
3. Decrypt only on the owner workstation, with the established private key and
   matching public certificate, outside GitHub. The local helper refuses
   `GITHUB_ACTIONS=true`, checks the recipient, GCM authentication, strict JSON,
   exact source/run binding, original hash, 454-byte/one-removal plan, and all
   closed receipt fields. It creates a new private receipt file without printing
   hashes. On Windows, also use a directory ACL limited to the owner and SYSTEM;
   POSIX mode 0600 alone is not a Windows ACL guarantee.

```
python -B scripts/strigunov4/c4_unit_receipt_envelope.py open-offline \
  --cipher <PRIVATE_DIR>/unit-receipt.cms \
  --key <EXISTING_OWNER_PRIVATE_KEY> --cert <MATCHING_PUBLIC_CERTIFICATE> \
  --sha <ACTUAL_APPROVED_SOURCE_SHA> --run <ACTUAL_NEW_RUN_ID> \
  --output <PRIVATE_DIR>/verified-receipt.json
```

The command requires OpenSSL 3 with CMS GCM/OAEP support on the local process
PATH. On the owner's Windows machine Git provides OpenSSL under
`C:\Program Files\Git\mingw64\bin`; add it to this process PATH only if needed,
without changing system settings. The command is a template, not authorization
to access the private key. Never
paste the key or decrypted receipt into Actions. CMS encryption authenticates
content integrity, **not sender identity**: anyone with the public certificate
can create ciphertext. Therefore verified GitHub artifact provenance is required
in addition to successful decryption. Preserve all prior logs and evidence.

## Coordinated four-pin update after real receipt

Use the existing pure local `candidates/c4_unit_pin_plan.py`; it checks current
file hashes and replaces exactly one OLD occurrence in each of these files:

| Active consumer | Reviewed source SHA256 at base |
| --- | --- |
| `staging_no_send_host.py` | `47a28c91608303c1f90f01d94fab21064ae8dc6423927c41b65c23ee5c3bcf7b` |
| `c4_staging_readonly_probe.py` | `fd69b6da1bb789304401549e2e37aba205c5116450d672690b03e0d324cfb117` |
| `protected_staging_host_probe.py` | `88ff94b04dd126468f172edcfeb66ed1b7c8e9ece5ac01d1bc3a2e02f70dee12` |
| `g0_activation_host.py` | `f3c9b9c313d0cbe5dd5afb0cf029a2174fa2a545310ce85df041efca459550ee` |

All paths are under `scripts/strigunov4/`. NEW must come from the fully validated
real receipt, never from a test fixture. Recheck current main and each exact
source hash; stop on drift. Update all four together and retain strict equality
to NEW, not `OLD or NEW`, wildcard, partial match or disabled checks. Test wrong,
old and masked hashes are rejected. These changes are a subsequent package,
not speculative replacements in this recovery patch.

Leave `candidates/systemd_candidate.py` byte-identical, SHA256
`986a0a0d794af465c7763d6ae1de0b6b2f142e427d225cceda4d666803c80d05`.
Do not rewrite history, candidate manifests, old receipts, the consumed workflow,
or the original-hash observation/repair precondition in `c4_unit_contract.py`.

## Next physical repair, separately authorized

The existing `C4-UNIT-CONTRACT-REPAIR.md` and offline transaction package remain
the repair basis. After obtaining NEW and coordinated pin review, separately
authorize the bounded staging repair: exact OLD/source and metadata recheck,
exclusive backup, byte-exact one-byte transform, atomic replacement, exact NEW
verification, approved daemon-reload, effective EnvironmentFiles and process
identity verification. Stale/different bytes or interruption require the
documented journal/backup recovery, never blind replay. Preserve old evidence.

A unit-only repair does not automatically authorize restart. The observed
process was stable and the manager had already loaded the optional directive.
Check the resulting manager state and preserve the current process; if a later
operator environment change requires restart, prepare its bounded permission
separately. Bookings, real sends, payments, production and Sentinel remain out
of scope. No pilot readiness claim until actual operator and physical acceptance.
