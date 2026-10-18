# Retained run 39127850376: protected read-only reconciliation

## Purpose and current boundary

The only authorized writer [39127850376](https://github.com/ASI-integration/asi-landing/actions/runs/39127850376/job/117676993521)
finished BLOCK at 2026-10-18 12:44:52 UTC on
`d46986fe7fa6b3a68a0490bf9be32f34206c7e06`. Its last receipt did not reveal the cause,
booking/intake IDs, child-start status or final counts. The write outcome is UNKNOWN.
No retry, replacement writer, cleanup or fixture reuse is allowed.

[#500](https://github.com/ASI-integration/asi-landing/pull/500) merged the reviewed
failure-reporting correction as `1b874a5aef2f299b03a8525a8879843df83c5ba5`.
That correction is not retroactive proof about the failed run.

This package prepares a reader, not a staging execution. The owner must separately
authorize the exact merged reader SHA and the database + host-read scope below;
the staging reviewer must approve both protected jobs. No such new authorization or live result is claimed here.

## Immutable scope

| Identity | Value |
| --- | --- |
| Consumed writer run | 39127850376 |
| User | dc194ac7-e586-4f7a-bd27-52fe743a89b7 |
| Account | 1ed26348-32e1-4e19-ae0d-07d3658f42ab |
| Property | ac431190-8cdb-4dfe-be89-3f3f83e258fc |
| Booking and intake | Unknown; discover only through fixed root/graph predicates |
| Old incident | 39047710115, unchanged fixed scope from the existing dependency reader |
| Staging project | meeravcldnmocjtlqoeu |

These values are source constants, not dispatch inputs. The old fixture and the
retained fixture remain separate. An ID collision, a foreign account/property/user
link, wrong synthetic marker or multiple candidates blocks acceptance and suppresses
candidate IDs in the public receipt.

## Mechanism

- Workflow: [strigunov4-c4-retained-readonly.yml](../../.github/workflows/strigunov4-c4-retained-readonly.yml).
- Reader: [c4_retained_readonly.py](../../scripts/strigunov4/c4_retained_readonly.py).
- The existing fixed dependency manifest, PG17 client pin, TLS verify-full target
  validation and exact migration-history gate are reused.
- PR jobs have no environment secrets. Protected execution is dispatch-only,
  exact-current-main, first attempt, fixed actor/actor ID, fixed incident and
  `environment: staging`. Checkout credentials are not persisted.
- Protected reads share the existing staging concurrency group with the writer
  and migration operations. No cancellation or automatic retry is introduced.
- The client requires `default_transaction_read_only=on`. Row access is inside
  a repeatable-read, read-only transaction. It takes ACCESS SHARE locks, repeats
  the complete catalog comparison, limits query/lock time, and ends with ROLLBACK.
- `row_security=off` makes restricted visibility fail instead of manufacturing
  empty results. It does not change a table policy or grant new privileges.
- One result statement observes old and retained graphs in the same snapshot.
  Source-known soft ownership columns and all manifest FK descendants are included;
  cycles are deduplicated and the node budget is enforced.
- Only validated table counts, fixed status counters, fixed root checks and uniquely
  scoped candidate UUIDs leave the process. No names, emails, messages, payloads,
  raw rows, SQL errors, hashes, credentials or unknown status strings are printed.
- The database job invokes no SSH, UI login, application endpoint, lifecycle handler,
  provider call, migration, account initialization, INSERT, UPDATE, DELETE or cleanup.
  Temporary local query/certificate files are private and discarded after use.
- A separate protected host job reuses the existing pinned G0 SSH probe in explicit
  config-only mode. It checks host identity, the fixed staging release/unit/process,
  seven effective process invariants (including app-root identity), the fixed pilot
  email's membership in both operator/admin allowlists, and GET health/version.
  It reads configuration internally but emits no environment values or key material.
  It omits all dashboard route probes, especially the existing negative POST tests.
  The physical writer's default five-route probe is unchanged.
- Host and database jobs are independent after source/isolated checks: a database
  schema failure does not prevent the separately approved host observation. Neither
  job can create a booking, log in, change settings, restart a service or run cleanup.
  The host job needs no session secret or Supabase service-role key.

## Reading the result

A successful read produces `C4_RETAINED_READONLY_OBSERVED`, never PHYSICAL_CORE_PASS.

| Observation | Meaning and next safe action |
| --- | --- |
| NO_ROWS_OBSERVED | No current graph matched. This does not prove that the writer never wrote. Retain roots and investigate the original preflight without rerunning it. |
| ROOTS_ONLY_OBSERVED | Durable roots exist, with no observed booking/intake. Preserve them; do not recycle identities. |
| PARTIAL_FLOW_OBSERVED | Booking or intake is incomplete. Preserve all evidence and inspect the reported current state. No replay or repair is authorized. |
| BOOKING_AND_INTAKE_OBSERVED | Exactly one of each is observed; this alone proves neither successful physical execution nor human UI access. |
| BLOCK | Identity, scope, cardinality, schema, visibility, state or old evidence requires reconciliation. Candidate IDs are suppressed where acceptance is unsafe. |

`tables` contains current linked/conflicting counts. Optional absent relations
remain null with NOT_DEPLOYED inventory, never invented zeroes.
`states` counts known intake, cleaning, linen, supplies and physical-readiness
states; readiness separately counts approved AND final_ready. Unknown state text
becomes an aggregate `unknown` counter and BLOCK.

`oldIncident` records current old identities and known evidence counts (24 audit
events, one of each physical row, zero intake), including mismatches. It explicitly
keeps `fullRowPreservationSinceWriter=UNKNOWN`: there is no retained pre-writer
full-row digest to compare with this new observation. Matching current counts
cannot prove historical full-row equality.

Historical write outcome is not inferred from this snapshot. The reader always
reports no replay/cleanup authority, FULL_PHYSICAL_E2E not proven and external
effects not independently proven. Counts in delivery/payment relations are evidence
about those deployed relations only, not network egress proof.

## Exact future execution plan — not executed

After independent review, protected merge and a separate owner decision, record
the full resulting current main SHA as M. The reviewed PR HEAD and M may differ;
never dispatch the source branch or substitute the old writer SHA.

Required decision scope: one read-only reconciliation of the fixed old and retained
graphs above plus the fixed G0 host/process/operator configuration and GET
health/version checks, using only this workflow at M. No new writer, host
configuration change, UI login, POST request, cleanup or protected setting change
is included. Protected credential names are STAGING_DATABASE_URL,
STAGING_SUPABASE_PROJECT_REF and (host job only) STAGING_SSH_HOST,
STAGING_SSH_PORT, STAGING_SSH_USER, STAGING_SSH_PRIVATE_KEY. Values stay inside
protected jobs; no local credential extraction is authorized.

Inputs:

```text
reviewed_main_sha=M
incident_run=39127850376
confirm=READONLY_C4_RETAINED_M
```

Here M means the actual full 40-character merged main SHA, substituted in all three
places that refer to it. The confirmation string is only an input guard; it is not
owner authorization. Before dispatch, verify owner evidence, exact main, current
required checks/review, unchanged environment protections and absence of an already
created run for that approval. Dispatch once, retain the run URL, then wait for the
authorized staging reviewer for both jobs. Do not approve on the owner's behalf.

After completion retain the full sanitized receipt, exact reader SHA, run/job URL,
attempt, current counts, state counters and any returned candidate IDs. If access,
catalog or snapshot validation fails, the result identifies only a fixed failing
stage, never exception data. Do not rerun automatically. Record the failure and
prepare a source correction or narrower decision.

Rollback: no database writes are planned. On timeout/error the read transaction
ends and no cleanup is required. Keep all historical and retained pilot evidence.

## Physical and independent acceptance after the observation

1. Establish whether the reader returned a unique booking/intake and no scope
   conflicts. Keep old/current observations distinct.
2. Compare cleaning/linen/supplies verified counters and readiness approved +
   final_ready counters for the unique scoped booking. Row existence alone is not
   task completion, and a DB snapshot is not an observed human demonstration.
3. Follow the [human observation checklist](C4-RETAINED-PILOT.md#independent-observation-checklist-after-the-existing-run)
   only through an independently authorized usable operator session. The synthetic
   password is deliberately unusable; do not invent a login or substitute a sealed
   API cookie. Login may create account records and needs its own scoped authority.
4. Correlate the exact returned booking with operator and CRM views. HTTP 200 or a
   screenshot of an unrelated queue is insufficient. Read-only DB work does not
   grant permission for page actions or background write endpoints.
5. Read the independent host job receipt: C4_HOST_CONFIG_READONLY_OBSERVED proves
   the fixed operator is currently allowed under the pinned process invariants.
   HOST_FRESH_OPERATOR_NOT_CONFIGURED or another fixed BLOCK code identifies a
   current failure only. Current host state does not prove the cause at 12:44 UTC.
   No server configuration repair is authorized by a read-only result.
6. Obtain existing independent egress evidence for 12:44:06–12:44:52 UTC and the
   relevant worker interval. Coverage must include the relevant host/processes and
   external providers. Do not send a real test message/payment to create evidence.
   If no independent observation exists, keep NOT_INDEPENDENTLY_PROVEN.
7. Update the [five-gate acceptance register](STRIGUNOV4-FINAL-ACCEPTANCE.md). No
   automatic promotion to READY_FOR_DEMO is allowed.

## Local/CI verification scope

Two focused files cover credential-free gates/receipt privacy and actual disposable
PostgreSQL17 SQL. Synthetic tests exercise no rows, roots only, partial intake,
one booking, duplicate candidates, wrong marker, foreign links, indirect graph,
current old drift, known/unknown physical states, config-only host mode with no POST, unchanged default
five-route host mode, schema race, RLS denial and an
injected write rejected by the read-only transaction. Full-row snapshots before
and after each read prove nonmutation of the disposable fixtures.

The isolated test setup writes only its empty loopback database using synthetic
credentials. These test-only setup statements never enter the protected reader.
Local and CI success establish the reader's tested behavior, not live pilot success.
