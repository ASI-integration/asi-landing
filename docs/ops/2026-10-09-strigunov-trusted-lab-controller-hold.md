# Trusted Strigunov lab controller — code-only hold, 2026-10-09

## Scope and verdict

This controller code is stacked on PR #427 at
6331de62d92e070a932670ce3aa8c31ad39872c8. Application code remains PR #426 at
c4e817f3fafa7115dee23f1b10d70be1bda4be2f.

The parent harness and its private acquireTrustedHost rejection are unchanged.
No controller is wired to the private database runner. No service, IPC endpoint,
trust roots, credentials, target, firewall rule or owner approval is installed.

CODE-PATCH may pass after focused source checks. TRUSTED ISSUER is BLOCK;
HOST AUTHN and REAL POSTGRES are BLOCK / NOT_RUN; CONSENT-LIVE and launch levels
1/2/3 remain BLOCK. UNIT_ONLY can never be promoted to ISOLATED_ACCEPTED.

## Source responsibilities

| Module | Responsibility |
| --- | --- |
| protocol.ts | Bounded canonical JSON, exact scope/pin validation, independent dual Ed25519 signature verification model and bounded signed receipt verification model. No signing or key generation. |
| state.ts | Pure single-use lease transitions, time/budget/scope checks, two-stage STOP, exact fixture ownership and cleanup state. |
| unit-file-store.ts | Explicit TEST-ONLY filesystem model with atomic lock, fsynced journal/ack records, replay and corruption detection. It is not imported by the service or CLI. |
| adapters.ts | Always-reject real issuer, native host, target, protected store, fault controller and receipt signer; pure observation-content models are separately named. |
| controller-service.ts | Separate process entry boundary; no listener is installed. Untrusted requests return ISSUER_NOT_PROVISIONED without inspecting them. |
| cli.ts | Untrusted, non-executing plan output; every flag remains blocked. |

Safe local checks:

    node --import tsx --test scripts/__tests__/strigunov-lab-controller.test.mjs scripts/__tests__/strigunov-public-lead-postgres-harness.test.mjs
    npm.cmd run typecheck

The following local commands only print a hold and exit 2:

    node --import tsx scripts/acceptance/strigunov-lab-controller/cli.ts
    node --import tsx scripts/acceptance/strigunov-lab-controller/controller-service.ts

Adding --execute, --approved, --roots, a URL, copied JSON or environment flags
does not enable them. No live execution example is supplied.

## Canonical signed scope

The closed capability schema covers exact repository, application and harness
SHAs; migration hash; privacy policy source/content/version; distinct owner and
custodian identities and their authorization-artifact digests; one nonce/run ID;
fixture namespace; exact sorted scenario and role allowlists; machine/cluster/
database/server boot/container/network/endpoint/schema identity; executable,
process start, service/token/pipe and ancestor ACL identity; bounded issuance,
not-before, expiry, duration, query/write/row/cleanup limits; and strict no-send,
no-egress, no-production, no-staging and no-migration policy.

JSON is bounded before parsing. Only the exact sorted-key serialization is
accepted: duplicate keys, alternate numeric forms, whitespace variants, escaped
aliases, non-ASCII values, unknown fields and wildcards are rejected. The
restricted ASCII/integer schema is intentional; this is not a general-purpose
JSON canonicalization implementation.

Only Ed25519 keys in exact canonical 44-byte SPKI DER and 64-byte signatures are
accepted. Each principal's key ID is SHA-256 of the DER public key. Both signatures
cover a domain-separated canonical payload. Owner and custodian must have distinct
principal IDs and distinct key fingerprints. Receipt signatures use a separate
domain and cover the complete receipt. No signature bypass or algorithm fallback exists.

The implemented public verification API is explicitly a MODEL:
authorityClass=UNIT_ONLY and the UNIT_ONLY signature domain are mandatory.
Throwaway private keys are generated only inside the test file and never written
to disk. Caller-supplied model roots are not installed trust roots. A valid model
result has executionAuthorized=false and is rejected by every real adapter.

## Independent owner/custodian provisioning — future task, not performed

Before any operational verifier can exist, the owner and custodian must separately
approve their exact roles and provision protected public-key pins outside the
harness, CLI, repository, user profile and environment files. Their private keys
must remain outside the controller's signing capability and outside AI-generated
fixtures. The controller cannot approve its own binaries, target, roots or receipts.

Provisioning must bind an explicit owner message/artifact and custodian artifact
to the exact action, target, code/migration identity, task cycle, allowable side
effects, verification plan and expiry required by docs/agent-os/OWNER_GATE.md.
A valid signature on a checkbox or typed confirmation is not enough.

Root rotation, revocation and rollback require separately scoped approvals and
durable protected root-version/consumption state. Copying the unit root file
shape into a service directory must never authorize anything. A new production
signature domain and reviewed protected-root loader are required, with explicit
rejection of all UNIT_ONLY artifacts.

## Native Windows authority — NOT INSTALLED

The adapter must be implemented and independently reviewed as a protected native
service before a positive Windows trust claim can be made. It must obtain facts
from OS-held handles/tokens, not caller fields:

- Actual token SID/authentication identity, service SID/account, process start and
  boot identity, service configuration and immutable executable hash/file identity.
- Owner and effective DACL of root, executable, journal, IPC and all ancestor
  directories, including file/directory replacement, delete-child and dangerous
  inherited rights. Protect service configuration and root-version state too.
- Reparse/junction/symlink and replacement-race defenses through opened handles.
  A lstat check followed by path-based access is not sufficient for live authority.
- Protected named-pipe peer token authentication/impersonation and server identity.
  PID, hostname, username, executable path, bare ACL text or a pipe name is not proof.

No Windows security setting was changed by this task. The TypeScript observation
model checks required content only and always reports hostAuthenticated=false.
No POSIX authority adapter is implemented either; UID/socket-peer protection
must not be inferred from portability of the unit filesystem model.

## Real target attestation — NOT VERIFIED

The custodian service must own a protected exact allowlist and reject production,
staging, public/ambiguous addresses, DNS rebinding, proxies and tunnels. It must
observe the real cluster system identifier, version, database OID/name digest,
boot/session/process/container/network namespace, pristine/exclusive target,
applied schema/version/migration hashes, actual service/anon/authenticated
privileges and FORCE RLS, and physical denial of every provider/Telegram/email/
webhook egress path.

An address such as localhost, fake Docker ID, socket filename, supplied JSON or
HTTP proof cannot establish this. There is no target probe, DNS lookup, firewall
change, DB connection, container startup or credential installation in this patch.

## Lease and journal semantics

ISSUED -> CLAIMED -> RUNNING -> FINALIZING -> VERIFIED is the successful MODEL
path. STOP first enters STOPPING, which prohibits new INTENTs. DRAIN reaches
FINALIZING only with no unresolved operations, otherwise RECOVERY_REQUIRED.
Revocation, expiry, clock reversal, changed boot, unknown commit or damaged
journal never returns a consumed nonce to ISSUED.

INTENT reserves signed scenario/role/query/write/row limits and is persisted
before a model operation could be handed off. Exact owned CRM UUID and receipt
digest must be recorded before COMMIT_UNKNOWN. COMMIT_ACK cannot precede that
sequence. An unknown result or missing UUID requires recovery. ROLLBACK_ACK
cannot erase a COMMIT_UNKNOWN. Budgets remain conservatively consumed after
rollback; cleanup also consumes bounded query/write budget.

The test-only model creates a unique temporary directory inside the assigned
worktree. It serializes transitions using exclusive mkdir, rereads/replays the
complete disk journal, writes and fsyncs an append-only hash-linked record, then
writes and fsyncs a separate immutable acknowledgment record before returning.
Two actual OS processes contend for the same lease in the regression test.

An abandoned lock is never stolen because a timeout passed or a PID disappeared.
A complete appended record without its acknowledgment, a missing complete record,
partial record, corrupt chain, changed root identity, unexpected acknowledgment
or observed reparse path requires recovery. The model never truncates, repairs
or overwrites the journal and never silently retries an unknown action.

The hash chain is not an authenticated external rollback anchor. A copied or
completely rewritten temporary directory is not durable global nonce authority.
Windows directory power-loss durability and native ancestor/ACL replacement
protection are not established by these Node APIs. The production protected-store
adapter therefore always rejects. Future global consumption/revocation storage
needs a protected monotonic anchor and native durability proofs.

Cleanup state accepts only the complete exact set of known, committed UUIDs,
within the signed namespace/row limit, and requires matching deletion/remaining
counts. No name/referral/contact search or broad database cleanup is implemented.
Only each test's own unique temporary fixture directory is removed after tests.

## Authenticated receipts and faults

The receipt model binds both signer identities, the complete capability digest,
nonce/run ID, application/migration/policy hashes, target binding, no-send digest,
journal head, approved scenarios, distinct OS PID/start/boot evidence, distinct
PostgreSQL backend IDs, exact owned fixture/consent digests and cleanup counts.
Only allowlisted error categories are accepted; raw messages, passwords, URLs
and contact payloads are excluded.

Receipt output is UNIT_ONLY. ISOLATED_ACCEPTED and PRODUCTION_RECEIPT are rejected
even if test signatures are valid. A separate authenticated signer/provenance and
independent evidence verifier are required before real acceptance can be issued.
Do not treat model process IDs or model receipt fields as actual DB observations.

FutureOwnedFaultRequest accepts only a signed lease digest, run/nonce/namespace,
owned process identity and backend PID, approved scenario, deadline and one of:
commit-ack-loss, restart-replay, utc-boundary or crm-receipt-atomicity.
It has no arbitrary shell, SQL, executable, kill target or provider API parameter.
The real adapter returns FAULT_CONTROLLER_NOT_INSTALLED; none of these faults was
performed on a real server or installed worker.

## Independent review and next authorized task

Review the exact final Draft PR SHA, including hostile canonical forms, independent
keys, real process contention, restart/corruption evidence, STOP/drain, budgets,
cleanup refusal and the unchanged parent gate. Verify no executable integration,
real root, credential or operational approval has slipped into the source.

The next coding task is the native protected host/IPC and durable store adapter,
including handle-based replacement protection and authenticated external root
provisioning interfaces. Keep it detached from the parent database runner.
Only after independent exact-SHA review and separately provisioned owner/custodian
authority may an exact empty disposable target and one bounded DB acceptance run
be proposed for separate authorization. No permission is granted by this runbook.
