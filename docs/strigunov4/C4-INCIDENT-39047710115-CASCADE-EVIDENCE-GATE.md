# C4 incident 39047710115 — cascade evidence gate (source-only)

Status: **DESIGN / NO STAGING MUTATION**. This document adds no workflow, executable code, authorization, migration, or approval. Branch exists to preserve analysis without changing protected `main`.

## Verified evidence

- The incident physical run [39047710115](https://github.com/ASI-integration/asi-landing/actions/runs/39047710115) created a synthetic booking but did not complete cleanup.
- The failed exact-ID cleanup [39056059835](https://github.com/ASI-integration/asi-landing/actions/runs/39056059835) returned an uncertain outcome. The later protected read-only census [39056502660](https://github.com/ASI-integration/asi-landing/actions/runs/39056502660) found all original 13 fixture counters unchanged. This is not proof about every other table.
- Protected deep read-only run [39062718446](https://github.com/ASI-integration/asi-landing/actions/runs/39062718446) returned SQLSTATE 42P01. The missing relation **has not been identified**. [PR 489](https://github.com/ASI-integration/asi-landing/pull/489) proposes a static-name read-only catalog preflight; source tests alone do not establish staging table existence.
- `public.booking_ops_events` has `booking_ops_record_id` referencing the booking with `ON DELETE CASCADE` (migration `20260628202122_booking_ops_timeline_v1.sql`). Unlike 13 existing counts, the exact cleanup script does not first assert that the incident has zero event rows. Source indicates they can exist; staging row count is not yet established.
- `public.partner_service_recovery_cases` and `public.partner_service_recovery_events` each reference `accounts` with `ON DELETE CASCADE` in `20260815190000_partner_service_recovery_loop_v1.sql`. The cleanup's predelete barriers and the 25 named deep-count categories omit these two tables; their rows might or might not exist in staging. Some recovery cases additionally have `ON DELETE RESTRICT` links to actions/handoffs, potentially blocking or changing deletion order.

## Read-only prerequisites before proposing a new cleanup

1. Separately authorize and complete the protected catalog preflight in reviewed `main`, using a freshly observed `main` SHA. Resolve the **exact missing relation**, not a guessed one. If a relation is missing, do not blindly apply migrations; independently review whether to make the census tolerate missing optional tables without any write, while treating missing critical tables as blockers.
2. After a safe read-only census is possible, obtain exact incident-scoped counts for booking event rows, partner recovery cases/events, physical-readiness children, delivery/auto-send attempts, and all catalog-discovered `CASCADE`, `RESTRICT/NO ACTION` and `SET NULL/DEFAULT` foreign-key descendants. A schema-level FK edge is not proof that a matching row exists.
3. Independently preserve appropriate event/audit evidence in a restricted, non-guest-visible channel **before** authorizing any cascade that would destroy it. Do not print guest records, secrets, contact details, or message bodies to Actions logs. Confirm the evidence-retention policy before deciding whether deletion of historical test events is permitted.
4. Prove every row belongs exclusively to the fixed synthetic user/account/property/booking UUIDs and is not linked to a real tenant or external partner. Unknown links, changing totals, unknown COMMIT outcome, nonzero delivery/send attempts, or unreconciled external effects must **BLOCK** deletion. Do not interpret no-send flags alone as outbound-delivery proof.
5. A reviewed cleanup candidate must check all identified descendants **inside a single bounded SERIALIZABLE transaction before parent deletion**, deny unauthorized cascades, check affected row counts, and independently reconcile after commit. Do not rerun failed mutation automatically or expand its scope with wildcard matches, global cleanup, disabled FKs, or `TRUNCATE`.

## Independent physical acceptance after cleanup

Only after separately approved, proven synthetic cleanup and an independently reviewed fix for the original physical-test failure: new single-use synthetic fixture, verified G0 release, no-send and independent outbound canary, dual-connection booking/CRM/availability/operator checks, crash/recovery, exact-ID cleanup, zero-residue verification, and a final protected reviewer attestation. No physical replay is authorized by this document.

**Result today:** source evidence/risk analysis only. SQLSTATE 42P01 and cleanup remain BLOCKED; no staging read/write, migration, deployment, send, PR merge or production/Sentinel changes are authorized.
