# C4 incident 39047710115 — exact-ID recovery, source-only proposal

## Proven facts

The owner-approved staging incident census [39051076374](https://github.com/ASI-integration/asi-landing/actions/runs/39051076374) returned `C4_INCIDENT_READONLY_AUDIT` for prior failed physical run [39047710115](https://github.com/ASI-integration/asi-landing/actions/runs/39047710115).

| Fixture reference | Count |
| --- | ---: |
| Exact test user | 1 |
| Exact test account | 1 |
| Exact property | 1 |
| Account membership | 1 |
| Exact owned booking | 1 |
| Owned booking operations | 1 |
| Booking tasks | 6 |
| Communication intentions | 6 |
| Telegram drafts | 1 |
| Availability conflict checks | 2 |
| Availability holds | 0 |
| Inbound intake events | 0 |

The staging read-only check succeeded. **The original physical test's cleanup remains BLOCK**, and observed external egress remains **not independently proven**. This proposal is an incident cleanup, not a new booking test, new feature, release installation, production change, or full demo acceptance.

## Safety architecture

One new protected GitHub workflow `strigunov4-c4-incident-cleanup.yml` uses the existing `staging` environment with required owner approval, main-only and exact SHA-bound owner confirmation. Pull requests only run source/negative tests without access to staging secrets. Source files, prior branches, production site and Sentinel are not modified by the workflow.

When separately approved after independent review/merge, the runner must:

1. Verify the exact allowed repository, owner account/ID, event, first attempt, current main commit, incident ID and stage-only credentials. Fail closed on missing/ambiguous values.
2. Independently establish the live G0 staging release and seven effective no-send flags over fingerprint-pinned SSH; verify exactly nine protected staging SQL additions and PostgreSQL17 TLS `verify-full`. No writes before those checks.
3. Query the **13 exact bounded fixture counts** with the same reviewed read-only audit SQL. Require byte-for-byte numeric match with audit run 39051076374. Any drift blocks before mutation.
4. Execute exactly one `SERIALIZABLE READ WRITE` PostgreSQL transaction with bounded timeouts and an incident-specific advisory lock. Before deleting any row, recheck synthetic account/user/property/booking identities, guest marker, account-member scope and every known child-row count. **Block if any related delivery or automatic-send-attempt rows exist**, regardless of status (these are separate child tables that cascade on intent deletion). Require the sole Telegram draft to have status `draft`, no chat ID and no nonblank target. These are safety/evidence barriers, not proof of zero actual external effects.
5. Delete only fixed UUID-owned availability conflict checks, communication intentions, tasks, one Telegram draft, the booking, property, membership, account and user. Do **not** delete production, real users, wildcard/prefix matches, unrelated properties, other bookings, unknown live rows, OTA entries or payment entries. Intake and holds are already absent and must remain absent.
6. Assert each expected `DELETE` affected the exact expected number of rows. Verify all known audited fixture tables have zero incident-matched rows within the same transaction. Any SQL error or changed count triggers rollback; do not blindly retry.
7. After `COMMIT`, use a **new read-only database connection** to establish all 13 counts are zero, and independently recheck G0 and no-send on the host. On an ambiguous COMMIT, an error, or a failed postcheck report `BLOCK`, **never automatically retry**. The owner receives a fixed `blockCode` and `stagingWrites: UNKNOWN` after any write attempt, never a false no-write claim. A completed clean result is `C4_INCIDENT_EXACT_CLEANUP_PASS`, not full physical E2E PASS.

All script-level failures print fixed code-only receipts; raw DB stderr, data, keys and guest records are not emitted. The origin incident fixed UUID set is imported unchanged from `c4_incident_readonly.py`.

## Limits and next step

This transaction ensures **zero residue in the 13 audited fixture categories** and is intentionally not a universal full-database row or audit-log deletion guarantee. If unknown foreign-key constraints block deletion, the transaction must roll back and an additional read-only investigation must be performed. No forced cascade or disabled safeguards are permitted.

**Current status:** candidate source only; no stage mutation performed in this PR. Do not merge before independent review, source CI and full PR checks. The existing temporary G0 release, nine SQL migrations and production/Sentinel must remain unchanged.

**Replaying physical core remains prohibited** until exact incident cleanup is confirmed and the original error is separately fixed and reviewed.
