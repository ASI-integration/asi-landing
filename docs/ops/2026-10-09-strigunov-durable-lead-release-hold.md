# Strigunov durable public lead admission — release hold

Code-only stack on PR #425, baseline d19bcc88c6f171de24661a623615d0bf216a3d4c.
Branch: astra/strigunov-durable-lead-20261009.
No database access, migration execution, real leads, deployment or live sending is authorized here.

## Gate meanings

- CODE-PATCH: focused unit/static checks only; see verified external task report for final results.
- MULTI-INSTANCE POSTGRES ACCEPTANCE: BLOCK / NOT_RUN. A mocked queue is not PostgreSQL execution.
- CONSENT-RECEIPT LIVE PROOF: BLOCK / NOT_RUN.
- LEVEL 1, LEVEL 2, LEVEL 3 launch: BLOCK.
- Parent bounded-byte behavior is retained. Real deployed source/version is not verified by this task.

## Transaction and retry semantics

Migration source: supabase/migrations/20261009151935_public_lead_admission_v1.sql.
Existing CRM columns/constraints come from 20260619000001_crm_early_access_v1.sql and the later
CRM event/archive/rollout migrations. No CRM queue or generic repository change.

The service-only SECURITY INVOKER RPC locks the singleton private admission_state row first.
Under that lock it pins the HMAC key commitment, takes database time after waiting (clamped
against backwards clock movement), checks a persisted receipt JOINed to the actual CRM row,
counts rolling windows, inserts CRM, inserts consent evidence, and advances the capacity counter.
A CRM key-share lock prevents deletion during replay. All work is in the caller transaction.
Any error aborts the transaction; there is no exception-swallowing partial-commit path.
At stronger isolation, serialization errors must produce 503/retry, never a local fallback.

Eligible identical normalized content replays for ten minutes from the first committed admission,
not a tumbling time bucket or sliding extension on each retry. It returns 200; new insert returns 201.
Beyond ten minutes a new admission is possible and consumes quota. This is bounded deduplication,
not indefinite contact uniqueness or proof of contact ownership. Contact/referral/policy/payload
changes produce distinct submission HMACs; body-provided IDs have no authority.
Contact case/phone formatting is canonicalized. No raw contact or unsalted contact hash is added
to the private receipt or public response. CRM retains its existing necessary contact fields.

Rolling limits are 150 NEW persisted admissions per 60 seconds globally and 3 per normalized
contact per 60 minutes. Successful replays do not consume a new admission; transaction failures
roll back quota. These are ingestion limits, not request/CPU/DDoS protection. Untrusted IP headers
are ignored. Lock waits expire at 2 seconds. No gateway/proxy controls are configured by this patch.
429 has an integer Retry-After in 1..3600. Missing migration/RPC, malformed receipt, issuer mismatch,
capacity exhaustion and unknown commit return generic 503. No automatic second write on RPC error.
After a lost HTTP/RPC response, a subsequent identical request reconciles from the same durable receipt.
There is no process-local authority, direct createCrmContact fallback, or public adapter injection.

## Privilege and threat boundary

The RPC is in the existing API schema so the existing service client can reach it, but EXECUTE is
explicitly revoked from PUBLIC, anon and authenticated and granted only to service_role.
It is SECURITY INVOKER with empty search_path and qualified relations, not SECURITY DEFINER.
Private schema usage and table access are revoked for untrusted roles; both tables enable and force RLS.
Service role has SELECT/UPDATE on the singleton and SELECT/INSERT on immutable receipt rows.
No new receipt UPDATE/DELETE grant, public read policy, enumeration API or CRM grant is introduced.
Existing CRM service-role privileges must be verified in isolated acceptance; source DDL is not proof
of deployed grants. Database superusers/service administrators remain trusted. Service credentials
already authorize CRM writes; this RPC is not a boundary against a compromised service-role holder.

PUBLIC_LEAD_HMAC_KEY is a new SERVER-ONLY configuration name, requiring exactly 32 random bytes
encoded as 64 hex characters. No value was read, provisioned, printed or written. Tests generate
ephemeral mock key material only. All workers must receive the same owner-provisioned high-entropy
key from the approved secret issuer. Syntax checks cannot prove entropy or issuer provenance.
A private SHA256 key commitment pins the first successful transaction; later inconsistent keys
fail closed. This is consistency detection, not authentication of first provisioning.
No automatic key rotation/reset is allowed. Rotation needs an independently reviewed migration/
overlap and existing-receipt reconciliation design; replacing the key alone causes 503.
Keys/HMACs are never logged or returned to anonymous users. Compromise of the key or service role
requires incident response, not treating pseudonymous HMACs as anonymous data.

## Consent artifact and privacy alignment

The existing strict consent=true normalization remains mandatory. The server supplies policy ID
/ru/privacy, version ru-privacy-20261009-v1, source hash, resolved content-artifact hash, source=form,
attribution and DB timestamp. The browser cannot set policy/time/hash via request metadata.
The receipt FK identifies the exact CRM row without duplicating its PII.
The content artifact is SHA256(JSON.stringify([sourceBundleHash, displayed controller name,
tax identifier, resolved public support email, correspondence address])).
sourceBundleHash is SHA256 of JSON array [path, LF-normalized source] for the RU privacy page,
ruCompliance config and contact config, in the helper's declared order.
Focused tests pin the source artifact and the existing form link; any text/config change requires
review and version/hash coordination, including a new append-only RPC migration for source-pin changes.
This is reproducible source-artifact evidence, not a hash of rendered HTML, proof that the browser
read the policy, a captured checkbox screenshot, or a legal sufficiency claim. Public copy is unchanged.
Owner must review effective policy, build-time support email, deployment/cache alignment, stale forms,
operator retrieval, retention, withdrawal/deletion and actual live receipts before launch.

## Storage, retention and rollback

Only successful new admissions allocate receipt/CRM rows, bounded by 150/minute and a hard cumulative
100,000-admission capacity hold. Rejected attempts and replays allocate no rows. Indexed receipt time,
contact/time and unique submission/time support bounded-window lookups; singleton storage is constant.
The lifetime cap never automatically resets and remains conservative after deletion. It is intentionally
an availability hold until an approved retention program exists, not a promise of unlimited operation.
Estimate capacity/alerts before release (at sustained maximum intake the cap is roughly 11.1 hours).

Consent receipts persist beyond the dedup/rate windows for accountability; there is no automatic TTL
deletion because legal retention is not established. Proposed future retention: expire dedup lookup
eligibility after 10 minutes and count eligibility after 60 minutes (already query-bound); choose
owner-reviewed consent retention/withdrawal policy before adding any scheduled purge. Never delete
consent on the short anti-abuse TTL. Authorized CRM deletion cascades its receipt, minimizing orphan
PII links and preventing false replay success; assess audit retention obligations before allowing that
operation. This task deleted nothing and added no cleanup worker. Global/contact counters can change
after an independently authorized CRM deletion; anonymous callers cannot delete receipts.
A future purge must lock admission_state first, preserve active quota/replay accounting, verify exact
owned rows and keep total capacity/retention accounting explicit. No wildcard cleanup.

Do not roll back by deploying the old process-local route with live intake enabled: it would bypass
durable admission and consent receipts. Owner-approved rollback must close intake first and use a
reviewed fail-closed app artifact. DDL history is append-only; forward fixes require new authorization.
Never drop private tables or reset the commitment/capacity simply to regain a green response.

## Required isolated acceptance, after separate authorization

1. Pin app and migration SHA/hash, trusted disposable DB identity, baseline schema/grants, denied egress,
   and fixture ownership/cleanup. Never use production credentials or change installed workers.
2. Compile/apply the source only in that explicitly authorized target; check pg_proc proacl/prosecdef/
   proconfig, schema/table ACLs, RLS/force flags, FK and indexes. Test anon/authenticated denial with
   actual separate roles; verify service_role cannot update/delete receipts by the new grants.
3. Use two actual PostgreSQL connections and two app instances sharing a mock-only provisioned key:
   identical concurrent requests with differing client IDs -> one CRM/receipt, 201+200; restart one.
   Revoke/delete fixture only under the approved cleanup scope; replay must not claim an absent row.
4. Force before-insert failure, after-CRM-before-receipt failure, post-commit transport loss,
   lock timeout, serialization conflict, missing RPC, and malformed RPC response. Capture durable row
   counts and transaction receipts; no success on uncertainty. A retry after commit must replay.
5. Race the last global/contact slots, rolling window boundaries and expiry; test key divergence,
   capacity hold, DB clock behavior and no new rows on rejects. Do not use mocked assertions as SQL proof.
6. Record explicit consent/referral/hash/time bound to exact created CRM aliases; verify no response IDs/
   hashes/PII, policy source and served version alignment. Capture genuine operator retrieval/ack separately.
7. Clean only run-owned fixture IDs in a reviewed finally/recovery path and verify absence, then obtain
   independent same-SHA review. Store raw evidence in restricted storage; public reports use aliases.

Next coding task: implement an isolated two-connection acceptance harness with trusted target provenance,
fault injection and exact fixture cleanup, plus a reviewed HMAC provisioning/rotation and retention plan.
Writing that harness does not authorize running it. Staffed operator assignment/ack and CRM acceptance
remain separate gates owned by their assigned writer.
