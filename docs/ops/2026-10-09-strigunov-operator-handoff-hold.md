# Strigunov operator handoff — source-only HOLD (2026-10-09)

No deployment, migration application, database connection, credential provisioning, owner approval,
customer message or installed worker is authorized by this change. Levels 1, 2 and 3 remain BLOCK.

## Current boundary

The private POST uses the existing CRM and Ops-admin guards, then explicit email allowlists in every
environment, a canonical session user UUID, exact Origin and bounded JSON. Assignment/backup selection,
reassignment and closure require Ops-admin identity. ACK/decline require the current operator.
The source-only transaction independently checks the approved roster and policy. No staff or policy
rows are seeded. Applicant role and referral never grant authority.

CRM_OPERATOR_HANDOFF_MUTATIONS_ENABLED is default-deny. This change does not set it in any environment.
The existing private GET only calls a SELECT-only projection RPC; missing schema returns an unavailable
handoff that needs operator reconciliation. It preserves referral, nextAction, nextBestStep and
lastMessagePreview. Existing private CRM fields are not copied to the handoff ledger.

The database is the authority for deadlines, membership validity, row locks, generation and event keys.
One contact UUID owns one ledger, including its terminal state. Reopen is intentionally unsupported.
Generation increments for every transition; a nonce rotates too, but is never returned to the browser.
ACK is acceptance of responsibility, not customer response or issue resolution. Resolved close requires
acknowledged state; withdrawn close is a separate explicitly selected admin action.
ACK time survives closure. Events are append-only and transactionally coupled to the ledger.

## Privileges and trust assumptions

The application role may not seed or change roster/policy. SELECT FOR SHARE requires UPDATE privilege
on at least one column, so it receives only identity-column UPDATE grants; provisioning guard triggers
deny all such writes by service_role, anon and authenticated. Row locks synchronize owner-side revocation.
The trusted database owner alone may provision approved records in a separately authorized operation.
These are source contracts, not a verified live privilege receipt.

RPCs are SECURITY INVOKER with an empty search_path; PUBLIC, anon and authenticated have no access.
A service credential is a trusted backend capability: possession is not an end-user authorization.
It must never reach a browser. Invoker mode necessarily gives that role ledger DML privileges.
A compromised service role or database owner is outside this boundary; this change does not claim
to constrain them. No new public endpoint, generic CRM store or provisioning endpoint exists.

The read projection uses VOLATILE for a fresh snapshot when called after mutation inside the
transaction; its body is only SELECT. Review PostgreSQL snapshot behavior in real isolated acceptance.
The policy and named staff records require approval digests, approval owner UUID, expiration and coverage;
a digest column alone is not evidence of genuine owner approval. Provisioning verification remains a gate.

## Deterministic INTERNAL-only overdue reconciliation plan — NOT INSTALLED

1. Separately authorize an exact reviewed SHA, isolated/production target as applicable, worker identity,
   allowed role/credential provenance, no-send boundary and maximum batch size. None is supplied here.
2. Future internal worker selects only assigned/escalated rows whose database ack_due_at is due. No
   browser action supports escalation. Never infer expiration from a customer timestamp.
3. For each snapshot, persist a request key: UUIDv5 namespace
   6d1eea10-4c4c-5c50-8c90-2ff8e1a5b408, UTF-8 name
   "crm-handoff-escalate-v1:" + lower-case canonical contact UUID + ":" + decimal generation.
   UUIDv5 is an idempotency identifier, not authentication. Only the trusted service role may call.
4. Call crm_operator_handoff_transition_v1 once with action=escalate, actor=NULL, snapshot generation,
   that key, and no assignee/backup/reason overrides. The RPC locks and rechecks DB time and roster.
   A qualified backup becomes the new assignee, with a new generation and a bounded DB deadline.
   Missing/revoked/stale backup, or the backup's own expired ACK window, becomes manual_overdue.
   A backup takeover still requires its own authenticated ACK; escalation is not an ACK.
5. A same-key same-generation replay returns the same current generation without a second event.
   Changed generation or changed payload is CONFLICT: read/reconcile; do not generate a fresh key
   to force an old action. Unknown commit/transport failure is BLOCK pending durable key reconciliation.
   Do not count HTTP failure as rollback. Policy unavailable or clock reversal is a manual BLOCK.
6. ACK/decline/reassign race with overdue execution: exact generation allows only one transition.
   No recipient, message text, provider call, scheduler installation or spontaneous task creation.
   Per-contact failures must not cause broad retries or resets.

## Required acceptance before any activation

- Independent exact-head source/security review; no self-certification of live readiness.
- Separately authorized disposable PostgreSQL: compile source, prove dependent schema, role grants,
  FORCE RLS, trigger protection and owner-only provisioning, no public RPC execution.
- Two independent real connections: first-assignment race, competing ACK, same-key replay, key
  collision, stale ACK/replay after reassign/escalation, rollback when event insert fails, lost response,
  owner-side revocation locking, clock boundary and reversal, absent policy, revoked backup, retry after
  service restart. Verify atomic ledger/event counts and no foreign record changes.
- A genuinely sealed application session for anonymous/nonoperator/operator/admin, production-equivalent
  allowlists, valid/revoked staff, correct/wrong user UUID, same-origin/CSRF controls and real 401/403/200.
  Mock getSession and serialized fake RPC results are UNIT_MODEL only.
- Owner names a real primary and distinct qualified backup, coverage/expiration, approved bounded
  primary/backup ACK SLAs and escalation/manual-overdue responsibility. No invented staff/approval.
- Canonical fixture ownership manifest and deletion/retention decision. ON DELETE RESTRICT plus immutable
  events deliberately prevents routine deletion of accepted history. Disposable database destruction
  under separate approval is the preferred lab cleanup; never disable these guards to clean production.
- Privacy/consent and release gates, independently accepted same-build staffed receipts and rollback
  compatibility. None is established by this code-only change.

Next safest work: independent exact-head review, then the separately scoped isolated acceptance adapter/
fixture-and-receipt work for this migration and existing CRM harness. Keep all execution gates closed.
