# C4 incident 39047710115: bounded read-only dependency proof

## Historical intake baseline correction after 39125804010

Protected read-only [run 39125804010](https://github.com/ASI-integration/asi-landing/actions/runs/39125804010) on `19dc0a38ba50c1156a34fd689128f1424bb21795` proved `user/account/property/booking` exact/by-ID counts of 1 and `intake` counts of 0/0, without any staging writes. This is **not** new evidence of a deleted row: a separate earlier protected read-only [run 39051076374](https://github.com/ASI-integration/asi-landing/actions/runs/39051076374), dated 2026-10-17 16:50 UTC, already returned `intakeExact=0` and `intakeOwnedScope=0`, before the uncertain cleanup run 39056059835. The strict source cleanup contract itself recorded the expected historical intake count as zero. The physical runner had reported an intake identifier, which alone did not prove the table still had that row by the earlier census.

The previous universal five-present identity requirement was therefore incorrectly applied to the old incident. This source-only correction uses the **evidenced old** five-count contract `[1,1,1,1,0]` and the **new separately approved retained fixture** contract `[1,1,1,1,1]`. The historical intake MUST remain absent: its exact and by-ID counts are both zero, and source-scoped linked intake count must remain zero. Any unexpected intake row, missing other root, cross-tenant graph edge, schema/FK/trigger drift, or permission failure continues to BLOCK. The new physical fixture still requires an exact owned intake row and one linked intake; there is no universal relaxed intake policy. In particular, `c4_retention_evidence.validate_snapshot` explicitly selects the fresh profile only for that fixture.

Nothing has been deleted, restored, inserted or replayed in staging. One new protected read-only dependent-row census is needed after a separately approved merge, exact-main-SHA owner consent and staging reviewer gate. A PASS would not itself authorize cleanup or physical booking.

## Protected C4 witness 39123643816: evidence identity BLOCK

After #497 the owner-approved protected read-only [run 39123643816](https://github.com/ASI-integration/asi-landing/actions/runs/39123643816) at protected main `a6d7f35a40aa7ff0fbb5f7c16ec783f73779831a` passed the schema and optional-module gates, then failed `INCIDENT_IDENTITY` on one or more fixed old synthetic identities. It never performed cleanup, migration, booking replay or staging writes. An older witness had confirmed the user, account, property and booking identities, but did not confirm this same five-part check on the intake account scope.

This source-only diagnostic preserves BLOCK and adds five static exact-vs-present-by-ID counts to the same READ ONLY locked snapshot. Public error details contain only five fixed labels and binary counts, never the sensitive rows, IDs, contacts or function definitions. A mismatch means audit/reconciliation is required, not that data may be deleted or altered. Repeat of the protected read-only workflow needs new exact SHA-bound owner permission and independent staging approval; run 39123643816 must not be blindly retried.

## Evidence, not cleanup authorization

Baseline: protected main 7bf3e1267beb71aed75ffede32f5c781ed95c075 after #492.
This source-only PR does not run staging, merge, migrate, deploy, archive, send,
replay or remove anything. Both #492 preservation barriers remain unchanged.

| Evidence | Proven by old protected witness | Still unproven |
| --- | --- | --- |
| booking_ops_events | 24 exact-booking events | Complete indirect row graph; retention permission |
| Physical records | One each cleaning, linen, supplies, readiness | Other dependent rows and permission to remove live evidence |
| Telegram draft | One pristine draft | Complete independent egress evidence |
| Deliveries / send attempts | Zero in that witness's specific queries | Zero external effects across all channels |
| Synthetic roots | One user/account/property/booking matching the fixture | No additional foreign or indirect references |
| Optional modules | Ten specified relations NOT_DEPLOYED | Deployment state of additional source-known relations |
| FK catalog | Candidate CASCADE, RESTRICT/NO ACTION, SET NULL/DEFAULT paths | Matching row counts and complete ownership |

Old evidence: [protected read-only run 39106534287](https://github.com/ASI-integration/asi-landing/actions/runs/39106534287).
The failed writer 39056059835 remains WRITE_UNCERTAIN_RECONCILE_BEFORE_RETRY.
Do not retry it. Read-only PASS is not physical E2E PASS. Pilot NOT_READY.

## Fixed source inventory

c4_dependency_manifest.json is reviewed source, not runtime-discovered SQL.
It lists 148 source-known relations and 234 declared FK paths, with migration
provenance, ordered key columns/types, primary keys and trigger signatures.
Initial migration declarations were inventoried offline; the guest-memory
surrogate primary-key replacement was reconciled against the later migration.
The runtime never parses migrations, accepts caller SQL, or turns catalog names
into queries. Unknown incoming FKs, including other schemas, block row access.

Scope includes the five immutable incident root IDs from c4_incident_readonly,
fixed logical account/property/user/internal-booking columns, the incident's
external booking key (read internally, never printed), and incoming FK closure
through known tables. Representative paths:
- booking -> audit events, physical tasks, intents, domain events, worker tasks;
- task -> intent (SET NULL), worker task -> secure link -> worker link audit;
- domain event -> event (NO ACTION self-reference), worker completion event,
  lifecycle decisions and autopilot state;
- booking -> checkin draft -> lifecycle state, including RESTRICT and SET NULL;
- account/user/property -> membership, operational, distribution and partner
  dependents, including ordered composite account/key FKs.

The manifest includes logical references without FKs where the named columns
are known. This is not a proof about opaque references embedded in JSON,
application-specific polymorphic strings, external systems, or unreviewed
trigger function bodies. Those require separate analysis before any mutation.
The result deliberately says **SCOPED_PASS**, never cleanup-ready.

All FK delete actions are traversed, not only CASCADE. UNION deduplicates full
(table, primary-key tuple) identities, including cycles and composite keys.
A 10,001-node sentinel blocks oversized graphs; statement/lock deadlines stop
unbounded work. No depth limit silently truncates descendants.
Rows selected via one incident link but pointing at another account/property/
booking or an unselected known parent are counted as scope conflicts.
NULL account ownership is unproven and blocks. incidentLinked is a count of
linked candidates, **not** a claim every candidate is owned or disposable.
Foreign rows unrelated to any fixed incident link are not included.

## 18 October: protected staging stopped safely at TRIGGER_DRIFT

Approved read-only staging run [39111579833](https://github.com/ASI-integration/asi-landing/actions/runs/39111579833) on `375569af41080c50fc7d8516531b79deadedcefa` returned `TRIGGER_DRIFT` at source-expected-vs-actual trigger schema comparison. It did not proceed to row dependency queries: stagingWrites=false, cleanupAuthorized=false, physicalReplayAuthorized=false.

This **source-only** change preserves the exact trigger-signature gate and reports all mismatching **source-allowlisted** table names, names of expected (source-known) but absent or changed triggers, and bounded counts of unexpected/changed trigger signatures. Actual unknown trigger/function names, their definitions, raw PostgreSQL errors and row data remain suppressed. `TRIGGER_DRIFT` is still BLOCK; never disable, drop, create or reinstall triggers just to make the report green. A separately owner-approved protected staging read-only run on the next reviewed main SHA is required before concluding what differs.

## Schema and privacy gates

Before row queries: fixed catalog census, required core relations, ordinary
non-inherited tables only, exact primary keys and referenced column types,
ordered FK columns/actions, validated/non-deferrable constraints, known trigger
signatures, and no rewrite rules. Any mismatch returns a fixed BLOCK code.
Additional absent source-known tables are explicitly notDeployed, with a null
table entry; they are not fabricated zero counts or asserted old-witness facts.

The row transaction acquires ACCESS SHARE locks, repeats the entire catalog
comparison in the same REPEATABLE READ READ ONLY snapshot, counts, then ROLLBACK.
default_transaction_read_only=on, row_security=off, verified target/TLS,
pinned PG17 client and existing migration-history gates remain mandatory.
RLS must fail rather than silently hide rows. No write operation is available.
The existing staging credential is confined to read-only connections; this PR
does not create/change roles or claim it has permanently revoked server grants.

SQL files use the existing read-only container bind mount, avoiding command-line
length limits. Errors and stderr are discarded. The public receipt contains only
validated counts, static table/column/FK-action labels and safety flags. Primary
keys, guest/message contents, contact details and credentials never enter it.

## Retention decision

Recommendation: **A: retain the entire old incident graph in place**.
It preserves the original journals and relationships, needs no irreversible
evidence deletion or archive-restoration infrastructure, and is the shorter path
to a separately approved new isolated synthetic test. It requires an explicit
owner decision accepting the old fixture as retained evidence, a new unique
namespace, revised residual-data criteria and independent isolation/no-send
checks before any new booking. This PR does not choose A on the owner's behalf.

B: a private complete archive plus verified restoration is appropriate if
the old fixture must ultimately be removed. It requires a complete approved
scope, private storage/retention/access policy, content/ownership/hash checks,
restoration rehearsal and an explicit decision allowing removal of live audit
evidence. A hash alone is insufficient. It adds work and irreversible risk.
Neither strategy lifts C4_DEPENDENCY_POLICY_REQUIRED in this PR.

## Future protected action (prepared, not executed)

Workflow: .github/workflows/strigunov4-c4-dependency-readonly.yml.
After a separately authorized merge, obtain the actual protected main merge SHA;
do not substitute the PR head or assume today's main remains current.
Inputs:
- reviewed_main_sha: that exact reviewed protected main SHA
- confirm: PROVE_C4_DEPENDENCIES_<same full SHA>
- incident_run: 39047710115

The next owner permission should authorize **only this read-only workflow on
that exact SHA**, followed by the independent staging environment reviewer gate.
The workflow requires the fixed owner identity, main/ref/workflow SHA agreement,
current remote main, first attempt, green focused jobs and environment staging.
A typed input does not replace either owner authorization or environment approval.
No live workflow is dispatched as part of this source-only task.

Stop on any identity/history/TLS/schema drift, unknown FK/trigger, missing core
relation or column, cross-scope count, inaccessible rows, graph limit or timeout.
Even a clean receipt leaves cleanup/replay unauthorized and the old evidence
untouched. A new physical acceptance is a subsequent, separately approved action.

## Focused local verification

11 unit tests and 9 real PostgreSQL17 isolated tests PASS. The latter cover
recursive/self-reference closure, indirect CASCADE/SET NULL, composite keys,
foreign scope, external-key collision, missing relations/columns, unknown
cross-schema FKs/triggers, catalog drift, permission denial, RLS, read-only write
refusal and full synthetic-row equality. Typecheck, YAML parse and diff checks
PASS. The dedicated temporary local cluster was stopped and removed.
No broad local suite was run; normal mandatory PR CI remains authoritative.


## Root fix after protected run 39118692946 (2026-10-18)

The approved [run](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946),
[job 117649791595](https://github.com/ASI-integration/asi-landing/actions/runs/39118692946/job/117649791595),
on main `beff46e55b73293774d210354d8276bea4812b2b` completed with BLOCK:

```json
{"blockCode":"TRIGGER_DRIFT","cleanupAuthorized":false,"physicalReplayAuthorized":false,"stagingWrites":false,"status":"BLOCK","triggerDriftCount":1,"triggerDriftDetails":[{"missingExpectedTriggers":["trg_guest_lifecycle_synthetic_scope_allowlist"],"table":"booking_ops_communication_auto_send_scopes","unexpectedOrChangedCount":0,"unexpectedOrChangedCountTruncated":false}]}
```

This proves a missing expected signature, not the historical absence of migration
20260810290000. No dependent row census followed the schema gate. The old
24 audit + four physical row witness was not refreshed. The aggregate history
postcheck postgres|17|99|7|9 cannot answer whether this particular version exists.

Source cause: the manifest combined source migrations into an unconditional
trigger expectation. The approved nine-version G0 candidate does not include
20260810290000. That version creates the compatibility function and trigger,
but also UPDATEs existing scope rows; replaying it is not a harmless catalog fix.
20261006101500 changes the function's search_path and must not be replayed either.
Neither migration, the G0 candidate nor the manifest's expected trigger is changed.

### Fixed version/object matrix

The reader now reads only aggregate facts about the exact history versions
20260810290000 and 20261006101500, the fixed public function
normalize_guest_lifecycle_synthetic_scope_allowlist, and the existing fixed table.
It requires ordinary non-inherited history storage with a text NOT NULL version
primary key and no rewrite rules. Missing/unreadable history is BLOCK, never absent.
RLS remains fail-closed with row_security=off; no migration names/statements or
other history versions are returned.

| Compatibility history | Hardening history | Function / trigger | Result before scoped census |
| --- | --- | --- | --- |
| Absent | Absent | No overload of the fixed public function; no compatibility trigger | NOT_DEPLOYED optional compatibility module; all other table/FK/trigger checks still required |
| Exactly one row | Absent | Exactly one zero-argument plpgsql trigger-returning function, no security-definer/set-returning mode, default configuration; exact enabled trigger | DEPLOYED metadata; all other checks still required |
| Exactly one row | Exactly one row | Same exact function, sole configuration search_path empty; exact enabled trigger | DEPLOYED with matching hardening metadata |
| Applied | Any | Function or trigger missing/wrong | BLOCK |
| Absent | Any | Function or compatibility trigger installed | BLOCK |
| Absent | Applied | Even if function/trigger absent | BLOCK: contradictory history |
| Any | Any | Extra overload, unknown trigger, disabled/wrong trigger, duplicate/inaccessible history, mismatched function configuration | BLOCK |

For this one optional trigger, shape includes enabled origin mode, BEFORE
INSERT/UPDATE row timing, the exact four UPDATE columns, no WHEN condition or
trigger arguments/constraint, and the fixed zero-argument function identity.
The complete table trigger list is still compared to reviewed source. An unknown
trigger cannot masquerade as an absent optional module. There is no skip flag,
caller-selected module/version, or runtime modification of the manifest.

The same witness is repeated inside the locked REPEATABLE READ READ ONLY census.
The history relation now participates in ACCESS SHARE locking. Any change between
initial admission and the second snapshot blocks; these locks do not claim to
prevent arbitrary concurrent DML for the entire lifecycle. Rollback, deadlines,
PG17/TLS/owner/environment gates and #492 preservation holds are unchanged.
The retained-pilot reader reuses this same schema checker and repeated witness.
A source-reviewed NOT_DEPLOYED module admits only this scoped schema audit; it
never supplies owner write permission, proves operator access, or authorizes
replay, deletion, real sending or a migration.

The optionalModule receipt contains fixed version/table labels, booleans and
counts only. On inconsistent known facts, OPTIONAL_MODULE_HISTORY_OBJECT_DRIFT
reports those safe facts. Unknown database object names, function bodies,
row contents, raw errors and credentials are suppressed. Function identity,
configuration and trigger shape are checked; arbitrary function-body provenance
and opaque JSON/polymorphic references remain outside this bounded proof.

### Regression and next gate

The two focused files cover both histories and hardening, missing function/trigger,
unregistered objects, overloads, disabled and unknown triggers, history races,
missing history and history RLS. Existing incident ownership, FK, rollback,
read-only rejection and whole-fixture non-mutation checks remain in place.
Independent CodeRabbit review of the final PR head is required before adopting
the new optional-module admission branch. Tests use disposable local/CI PG17;
no staging SQL or configuration is executed by this source package.

After an explicitly approved protected merge, record actual resulting main M.
Obtain a new owner authorization for only dependency-readonly.yml, ref main,
reviewed_main_sha=M, confirm=PROVE_C4_DEPENDENCIES_M, incident_run=39047710115.
Then the staging reviewer separately approves that exact run. Neither a prior go
nor the previous failed run authorizes a rerun or a new SHA. First reuse any
matching already-created run. Preserve all safe receipts, including BLOCK.
Only a real result can establish which matrix row staging occupies.

Local final source validation: 16 unit tests and 12 actual isolated PostgreSQL17
tests PASS, plus typecheck. The disposable cluster was stopped and removed.
Existing broad checks were not restarted locally. CI and the independent review
are recorded against the new PR head in its verification record.
