# Atomic Booking Ops quota: RELEASE HOLD
Date: 2026-10-09. Stacked on PR #423 / c8f68319a1575d09efd06119d9473ca1997efe40.
This is code and unit evidence only. No migration, provider, deployment or activation is authorized by this document.

## Admission contract
The executor retains existing content, legal, physical, availability, quiet-hour, explicit policy and operational-scope checks. It calls booking_ops_atomic_quota_v1 before the sender; missing RPC/schema, error, timeout, malformed response or denial means zero sender calls. Supplied count/policy objects cannot reserve quota. Production rejects injected sender/scope/voice seams.
The RPC owns the sending claim and receipt. PostgreSQL serializes admission through a per-account mutex row UPDATE in the same transaction as both count checks, receipt insert and delivery claim. The generation UPDATE also prevents stale repeatable-read snapshots from admitting based on an old count: serialization errors are fail-closed. This intentionally serializes one account's admissions; optimize only after real stress evidence.

Lock order: global guard -> account mutex -> delivery -> existing reservation -> intent -> booking record -> canonical property -> policy -> narrow scope. Every phase follows that prefix. Locks do not span a provider request.
Finite booking limit uses (account_id, canonical booking_id); finite guest limit uses (account_id, hash(lower(trim(canonical guest_email)))) across bookings and channels. UTC admission date comes from PostgreSQL clock. Unlimited dimensions skip cap checks; a receipt is still required for replay/crash safety, not an arbitrary quota counter. Known sent receipts count on admission UTC day; held/dispatching/uncertain receipts count across dates until separately reconciled. Dispatch crossing UTC midnight is refused rather than mischarged.
Persisted winning booking/property/global policy and winning booking/property account scope are reselected, not trusted from caller parameters. Zero/nonpositive persisted caps are rejected (the parent schema already disallows zero); null means unlimited. No client counts/caps enter the RPC signature.
Tenant linkage is derived from delivery -> intent -> booking_ops_records -> properties and checked against canonical accounts. Text booking IDs are exact opaque keys, never inferred from untrusted metadata.

## Deliberately unsupported identity cases
Only guest deliveries whose channel recipient exactly equals the canonical booking record contact and whose canonical guest email exists are eligible. Email is a conservative contact identity, NOT proof of a real person's identity; reviewed contact ownership and stable canonical email across bookings remain operational prerequisites. Metadata-only or staff recipient bindings cannot establish authority and are blocked until a separately reviewed canonical staff identity design exists. Mixed-case/untrimmed legacy delivery recipients may need review rather than silent normalization.
Owner/pilot scopes and owner-only policy overrides cannot bypass the canonical booking/property binding. Automatic voice follow-up is disabled; a voice message is a second delivery and needs its own future reservation/owner policy. Do not enable sending to compensate for these restrictions.

## Durable crash states
| Window | Persisted state / response | Recovery |
|---|---|---|
| Before reserve transaction | No receipt; no provider | Re-evaluate from scratch if no prior claim exists. |
| Reserve rollback/failure known | No new receipt | Zero provider; blocked operational result. |
| Reserve commits, response lost or process crashes | held + sending | Zero automatic repeat. Read-only owner reconciliation. |
| Revocation or content/scope change after reserve | held + sending | Annotate quota_review_required when possible; no provider. |
| Dispatch transition commits before provider | dispatching + sending | A crash is indistinguishable from a request that reached provider; hold. |
| Provider timeout, exception, Boolean false | uncertain (or dispatching if evidence write fails) | No automatic release or resend. Boolean false is not proof of non-acceptance. |
| Provider accepts, result write fails | dispatching/sent receipt; sending delivery | No resend; correlate known provider ID through restricted evidence. |
| Success and persistence known | sent receipt and delivery | Duplicate call returns prior result without another send. |

There is deliberately NO reservation release/retry/delete endpoint or expiry. Even a provable pre-send cancellation is retained by this patch. A future separately authorized reconciliation must fence all workers, identify exact receipt/target/account/delivery, establish authoritative no-send evidence or provider outcome, preserve audit lineage and independently review any release. Never treat elapsed time, an exception, a failed delivery label or a caller-provided Boolean as no-send proof.
Once dispatch is durably admitted a new emergency stop cannot recall a network request. A stop committed before the dispatch gate blocks it. Operational emergency acceptance must prove scheduler stop/drain and all in-flight outcomes; do not promise instantaneous cancellation after admission.

## Privileges and rollout
Two new RLS-enabled tables. PUBLIC/anon/authenticated have no access. Service role can read receipts, but cannot insert/update/delete reservations or mutate mutex directly. Narrow SECURITY DEFINER RPC with empty search_path and qualified tables is executable only by service_role (and DB owner). A trigger fences new legacy sending claims and freezes admitted delivery identity. The service backend is trusted infrastructure; API-role callers cannot manufacture reservations.
Never print raw SQL errors, contacts, credentials or provider contents. Application errors expose a stable quota_review_required code. Receipt payload/recipient/email hashes are sensitive correlation data, not public anonymization; keep them restricted. Provider message IDs are recorded only when known.
Legacy sent activity today, and any unreconciled old sending/failed delivery, blocks account admission rather than undercounting. Do not clear history or manipulate status to evade that hold.

Before ANY SQL execution: independent exact-commit SQL/code review, owner-approved disposable PostgreSQL identity, no production credentials, denied provider egress, synthetic fixtures, safe cleanup plan. Apply is not part of this coding task.
Release procedure must separately quiesce/drain ALL old workers before rollout. The new DB trigger blocks old new-claims, but cannot recall a worker that already claimed before the migration. Confirm no unknown provider outcomes. Review migration privileges/RLS and constraints on actual supported PostgreSQL. Keep all actual_send_enabled/scheduler flags off.
Application deployed without the migration blocks rather than falling back. Migration with old app blocks new old-style sending claims. This is intentionally a release hold, not a compatibility auto-bypass.
Rollback: keep emergency stop and sends disabled, retain receipts and fence, and prepare an owner-approved forward fix. Do not drop reservations or roll back to a sender that can bypass quota. No destructive down migration. Existing foreign-key RESTRICT keeps historical receipt ownership from disappearing through cascade deletion.

## Required independent acceptance (NOT RUN)
The Vitest RPC simulator exercises application boundaries and serializes in memory; it is NOT PostgreSQL concurrency proof. Static SQL assertions do not compile or execute PL/pgSQL.
Before ATOMIC-INTEGRATION PASS: pinned migration checksum + DB version; actual privileges as anon/authenticated/service role; two independent processes racing the last booking slot, guest slot and both; exact-cap/null/zero and separate tenants with identical strings; separate delivery IDs/same idempotency; transaction isolation/serialization failures; recipient/canonical scope mismatch; missing schema/RPC; concurrent policy/scope revocation; UTC rollover; legacy-history hold; connection loss before/after reserve/dispatch commit; provider-spy acceptance followed by process death before persistence; no resend after restart; no-send count and exact owned-fixture cleanup.
Exercise dispatch denial and stale-worker mutation as well as happy path. Real provider/network traffic stays forbidden. Do not label a mocked race or a CI badge ATOMIC-INTEGRATION PASS.
LIVE-AUTO-SEND stays BLOCK until independent integration acceptance, parent #423 acceptance, scoped deployment/migration authorization, reviewed guest/contact identity, stop/drain/reconciliation procedure, operator coverage and separately authorized activation all have receipts.
