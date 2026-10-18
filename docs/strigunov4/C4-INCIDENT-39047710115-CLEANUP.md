# C4 incident 39047710115 — preservation hold, not an executable cleanup approval

## Observed evidence and source audit

Protected read-only [run 39106534287](https://github.com/ASI-integration/asi-landing/actions/runs/39106534287)
at main `9eb3d1ee19f016c2bbaef75ef3da10d6272bcca3` reports 24
`booking_ops_events`, one each cleaning/linen/supplies/readiness row,
one pristine Telegram draft and ten absent optional guest/partner tables.
Zero deliveries/attempts in that witness does not independently prove zero egress.
The prior 13-category census is insufficient to authorize parent deletion.

Concrete unsafe paths in the historical cleanup:
- Deleting the booking can cascade away 24 audit events; these were not counted.
- The four physical rows are evidence, not automatically disposable tasks.
- Guest/partner tables are referenced unconditionally even when not deployed.
- The FK catalog includes indirect CASCADE, RESTRICT and SET NULL/DEFAULT paths.
  Table names alone are not matching-row counts or a complete deletion policy.
- A failed writer can leave COMMIT outcome unknown. Never retry the historical
  run 39056059835 based on an exception or the old 13 counts.

## This change: fail closed before any writer

The existing owner/repository/main/SHA/incident/history/host/no-send gates remain.
After the exact 13-count comparison, a separate SERIALIZABLE READ ONLY census
counts the exact booking's audit events and six physical categories. Optional
relations are examined only by fixed-name `to_regclass`; missing names are
sorted explicit schema evidence, never fabricated zero row counts.
Missing required columns/tables or insufficient read permission fail closed.
No caller-supplied identifiers, credentials or database rows are emitted.

The Python gate returns:
- `C4_AUDIT_PRESERVATION_REQUIRED` for nonzero audit evidence;
- `C4_PHYSICAL_PRESERVATION_REQUIRED` for nonzero physical evidence;
- `C4_DEPENDENCY_POLICY_REQUIRED` even if those known counts are zero.

That final unconditional hold is intentional: no preservation policy or full
row-level dependency census has been accepted. There is no flag, environment
variable, owner phrase or receipt field that turns this hold off. A newly
reviewed source change and separately authorized protected execution are needed.

A second barrier is inside the existing SERIALIZABLE transaction, after the
incident advisory lock and before the legacy preconditions or DELETE statements.
It rechecks audit/physical counts and always refuses deletion. Even direct
execution of the generated SQL rolls back. The legacy DELETE and optional-table
statements are retained as historical candidate code, but **are unreachable**.
This is NOT a newly enabled schema-compatible deletion procedure. Optional
absence can no longer be used as an excuse to skip evidence preservation.

The old identity/scope/count checks, transaction boundaries, rollback behavior,
uncertain-write handling and independent postflight remain in the retained
candidate. They are not sufficient evidence to lift the new hold.
There is no merge, staging execution, deployment, migration, cleanup or replay
in this change. Production and Sentinel remain outside scope.

## Focused proof

16 credential-free unit cases cover authorization, identity/count drift, unsafe
host preflight, malformed receipts, optional-schema semantics, read denial,
zero writer calls, error redaction and uncertain-write reporting.
Six real isolated PostgreSQL17 cases cover 24 audit events plus indirect FK
children, physical/foreign rows, zero-count refusal, atomic rollback of an
earlier write in the same transaction, denied access and ten absent modules.
The PG suite requires an explicit opt-in and a dedicated empty loopback database;
it does not use staging data or staging secrets.

## Safe path to a future physical finish

Current policy: retain the complete incident fixture in place, including its
parent rows, audit events and physical records. No detaching FK, changing
ownership, disabling triggers or moving evidence is authorized.

Before enabling any future cleanup, separately review a fixed, read-only census
of every direct and indirect dependent row, column type, FK action, trigger,
tenant boundary and row identity. The existing depth-limited catalog is only
a starting point; it must not become an arbitrary dynamic SQL traversal.
That is necessary for mutation admission, but not necessary to prove the present
hold: the 24 already observed audit events alone prohibit the old deletion.

The owner then chooses an explicit retention policy:
1. Preserve this incident fixture as evidence and authorize a new isolated
   test namespace, with an explicitly revised residual-data acceptance criterion;
   this is not cleanup of the old fixture.
2. Prepare a separately reviewed private archive of the complete incident graph,
   verify its contents/ownership/hashes and a restoration rehearsal, then decide
   whether archive retention legally and operationally permits removal of live
   evidence. An archive hash alone is insufficient. No archive is created here.

Do not promise both deletion of all parents and preservation of their cascading
live audit children under the unchanged schema. No additional guest/partner
migration is justified merely to make cleanup run.
Any future mutation needs its exact reviewed source, fresh read-only evidence,
owner permission, staging environment approval and independent postflight.
**Pilot NOT_READY. No physical replay authorized by this PR.**
