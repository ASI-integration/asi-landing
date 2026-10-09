# Strigunov isolated PostgreSQL acceptance hold — 2026-10-09

## Current verdict and scope

CODE-HARNESS is an offline code/test gate only. TRUSTED-TARGET and REAL POSTGRES
TWO-CONNECTION ACCEPTANCE are BLOCK / NOT_RUN. Consent-live and launch levels
1/2/3 remain BLOCK. This revision does not install a host, issue an approval,
connect to PostgreSQL, execute migrations, submit a lead, or produce a production receipt.

The parent application is PR #426 at
c4e817f3fafa7115dee23f1b10d70be1bda4be2f, based on PR #425 at
d19bcc88c6f171de24661a623615d0bf216a3d4c.
The parent migration is unchanged:
supabase/migrations/20261009151935_public_lead_admission_v1.sql.
Its Git-blob / LF-normalized SHA-256 is
bb76c753d3dcbc51e3ea81bb474a60a99da64809e06b6b163f549282afe4967c.
Windows CRLF checkout bytes have a different hash; do not mistake that for a SQL change.

## Safe offline use

From this task worktree with its existing dependencies:

    node --import tsx --test scripts/__tests__/strigunov-public-lead-postgres-harness.test.mjs
    node --import tsx scripts/acceptance/strigunov-public-lead-postgres-harness.ts

The second command deliberately exits 2 with PLAN_ONLY / BLOCK and all scenarios
NOT_RUN. --execute, --dry-run and every other argument also exit 2, BLOCKED.
Environment flags, credentials, URLs, loopback, fake Docker IDs and proof JSON
cannot change this. The exported requestExecution ignores its argument without
reading properties or invoking callbacks. It calls a private unimplemented
acquireTrustedHost that always rejects before the dynamic pg import.

There is no execution command in this revision. Do not patch the gate during an
operator session. Any future integration is a separate reviewed coding task and
requires a separately authorized isolated execution task afterward.

validateContract accepts bounded JSON text containing exactly the offline plan.
It returns UNIT_CONTRACT_PASS only for shape, never ISOLATED_ACCEPTED.
Caller objects, getters, proxies, invented target receipts and forged PASS
scenarios do not constitute proof. The unit suite installs network canaries and
checks the pg module cache in a fresh subprocess; it does not mock PostgreSQL
and count the mock as database acceptance.

## Future trusted host contract — not installed

The issuer must operate outside caller-supplied data and the harness process.
It must verify exact-scope owner authorization and custodian attestation of a
new empty disposable database before issuing an expiring, single-use exclusive
lease. A boolean, filename, pasted approval or signature-shaped JSON is not an issuer.

Mandatory attestation includes:

- Actual cluster system identifier, server version, database OID/name hash,
  host boot identity, process owner, container and network namespace ownership.
- Independent pristine CRM/receipt/state verification, exclusive fixture scope,
  migration Git-blob hash and applied schema hash/version, application SHA,
  current policy source and rendered-content hashes.
- Real service/anon/authenticated privileges and FORCE RLS state, plus the
  dedicated custodian role needed for catalog observation and exact cleanup.
- Effective network egress denial and external-action denial, including all
  messaging/webhook/provider routes. A no-send flag alone is insufficient.
- A sanitized execution environment with no inherited PG*, DATABASE_URL,
  service credentials or external-provider configuration; explicit complete
  per-role connection configuration with bounded resource settings.
- Independently verified separate PostgreSQL backend PIDs. Restart testing also
  requires actual separate OS process IDs and process start identities.

The shape checks inside the dormant runner are secondary consistency checks.
They do not authenticate an issuer. Only a separately reviewed trusted adapter
may implement acquireTrustedHost; there is intentionally no injectable factory.
The future host must bound all operations and prove lease-owned backend
termination before target release. A missing capability keeps execution blocked.

## Real suite and evidence expectations

The private executeOnTrustedHost contains actual parameterized pg.Client SQL,
with separate service A/B connections and an independent observer. It does not
use pool.query for transactions. Node/Postgres deadlines are 3 s connect,
4.5 s statement, 6 s client query, 8 s idle transaction and 180 s suite;
RPC's own 2 s lock timeout remains unchanged. Custodian operations have their
own bounded deadlines. Timeout never grants permission to clean an uncertain write.

| Scenario | Actual future observation required |
| --- | --- |
| Same payload, RC/RR | A holds singleton; observer sees B blocked with pg_blocking_pids; one creation plus same-UUID replay. RR must produce 40001 then retry the entire transaction. |
| Different payload, RC/RR | Same contact, distinct canonical HMAC payloads persist independently; RR serialization retry is observed. |
| Global last slot, RC/RR | 149 actual committed seeds then two contenders yield exactly 150 receipts and a bounded rate-limit response. A seed window over 40 seconds blocks the test. |
| Contact last slot, RC/RR | Two seeds then contenders yield exactly three receipts for one HMAC contact. |
| Explicit rollback | CRM, receipt and total-created counter all unchanged after admission/ROLLBACK. |
| Pre-commit disconnect | Old backend absent and all three persistence counts unchanged before a fresh-session retry. |
| Consent persistence | CRM+receipt join survives reconnect with exact source/referral/consent/policy/content/source hashes; replay keeps UUID. |
| Privilege denial | Actual anon and authenticated sessions get 42501 on RPC and both private tables. Service RPC succeeds. |
| Missing RPC / key / consent | 42883 or explicit P0001 rejection; no alternate storage path, CRM/receipt counts unchanged. |
| Lock timeout | Real singleton wait returns 55P03, transaction rolls back, retry succeeds. |
| Deadlock | Two run-owned advisory locks are inverted on real sessions, a 40P01 victim rolls back and admission retry succeeds. This is a driver/transaction recovery test, not a claim about application lock topology. |
| Logical clock / capacity | Future watermark and 100000 capacity changes are transaction-local and rolled back; no parent SQL edits. Logical watermark testing is not actual OS clock reversal. |
| Lost COMMIT acknowledgment | Custodian proves request sent, server commit and dead backend; exact journaled UUID/receipt is reconciled, then retry replays. |
| Process restart | Custodian starts separate OS workers using the in-memory synthetic request; process identities and persisted replay are verified. |
| UTC boundary | Custodian controls isolated time; third contact admission crosses UTC boundary, fourth remains limited. No real host clock change is allowed. |
| CRM/receipt interruption | Custodian induces a verified fault between the two writes in the disposable lab; the whole transaction rolls back. Never alter the parent function as part of this harness run. |
| Exact cleanup | Target reattested; only journaled UUIDs with matching contact/submission digests removed; row counts and post-commit absence agree. |

The last four fault-controller scenarios contain typed arm/finish orchestration,
but there is no installed real wire/process/clock/failpoint controller. They must
remain REAL_ONLY / NOT_RUN until that separately reviewed host exists. Its
receipts must be independently authenticated, never fabricated for unit tests.
The restart request includes synthetic payload and key commitment only through
the trusted in-memory channel; do not persist contact values in the evidence.

## Ownership, journal and recovery

Every future run creates a cryptographically unpredictable UUID namespace and
ephemeral HMAC key. Emails use example.invalid; no Telegram or real contact is
used. A durable custodian journal must acknowledge fsync of the INTENT before
the RPC, exact returned UUID and digests before COMMIT, COMMIT_UNKNOWN before
sending COMMIT, and COMMITTED only after acknowledged commit or independent
reconciliation. Never infer ownership from a contact search or guessed prefix.

Missing UUID, uncertain commit, failed journal acknowledgment, target mismatch
or unverified backend shutdown means RECOVERY_REQUIRED. Preserve the durable
journal and stop; do not issue broad DELETE, search-and-delete, reset a quota
counter or silently discard evidence. A query timeout does not prove rollback.
Only acknowledged rollback or independently verified backend death plus exact
state reconciliation resolves an ambiguity.

Automatic cleanup requires no unresolved journal entries, a fresh identical
target attestation and exact UUID/contact-HMAC/submission-HMAC equality under
the singleton lock. It checks DELETE RETURNING counts, cascading receipt absence,
and post-commit absence. Cleanup does not reset total_created, key commitment or
last_seen_at: the disposable target is single-use and later destruction belongs
to its separately authorized custodian. No target destruction is implemented here.

## Evidence vocabulary and redaction

- PLAN_ONLY: deterministic offline inventory; zero PostgreSQL and cleanup calls.
- UNIT_CONTRACT_PASS: offline code/shape checks only; databaseAccepted=false.
- POSTGRES_STATIC_ONLY: source review or SQL design inspection, not execution.
- BLOCKED: missing trust/capabilities/checks; no acceptance inference.
- RECOVERY_REQUIRED: unresolved write/cleanup/backend/journal outcome.
- ISOLATED_ACCEPTED: reserved for a future independently verified, signed acceptance
  receipt. This implementation cannot emit it, even after all future observations.
- PRODUCTION_RECEIPT: unsupported, always rejected; no launch authorization.

Future journal observations include UTC timestamps, run/scenario identifiers,
redacted target alias, cluster/session/process provenance held by the issuer,
application/migration hashes, exact owned fixture manifest, transaction outcomes,
quota outcomes, consent policy hashes, no-send receipt and cleanup counts.
Only allowlisted SQL error categories may leave the process; never raw driver
errors, stack traces, passwords, URLs or contact payloads. HMAC keys are ephemeral
and cleared at shutdown. The trusted host must restrict journal access and
authenticate the final evidence independently.

## Next gates

1. Review this dormant implementation and offline test evidence as a stacked Draft PR.
2. Implement and independently audit the out-of-process issuer, fsynced journal,
   disposable target identity probe and real fault controllers. Keep the gate
   rejecting while this integration is incomplete.
3. Obtain a separate exact-scope owner/custodian approval for an empty isolated
   target and one bounded acceptance run; prepare schema only under its own
   authorization. This document grants neither permission.
4. Execute the real suite only then, resolve cleanup/recovery, and independently
   verify a signed isolated acceptance receipt. Live consent and launch levels
   remain separate gates. Do not merge or deploy from this harness task.
