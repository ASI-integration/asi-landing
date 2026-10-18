# C4 incident 39047710115: bounded read-only dependency proof

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
