# Strigunov4 systemd installation and rollback candidate

Status: BLOCKED / not executed. Application target remains
334d93fc39d2ea51ba283dd0314bbc239ff49707, not this diagnostic branch's HEAD.
Never run the existing deployment continuation on this branch. Its schema hook
exits97 only WHEN run_smoke_test=true. This input defaults false in main.
Only an explicit true diagnostic dispatch is safe; arbitrary dispatches of the
old main workflow are NOT repaired by this branch. It must not be merged as a production migration smoke replacement.

## Recovery prerequisites

Before any DDL or switch, obtain a new security-complete encrypted backup of
project meeravcldnmocjtlqoeu through main-only staging environment with required
reviewer. Existing archive was made with --no-owner --no-acl: it is insufficient.
Capture roles (without login secrets), ownership/grants/default ACL/RLS, schema,
data, extension versions and migration history. Restore into a disposable,
compatible PostgreSQL17 runtime including supabase_vault. Do not omit extensions,
post-data or security errors. If Vault contents depend on unavailable root key,
record that recovery gap explicitly; restored ciphertext rows are not proof of
recoverability. Keep ciphertext and recovery key in existing private durable
storage, never GitHub logs/public artifacts. Verify hashes, TOC, full restore
exit0, constraints/indexes/triggers/RLS/grants/owners/function hashes, migration
history, row-count parity and authorized role negative tests. Do not use restored
provider credentials or start any workers in the recovery instance.

Protected maintenance workflow must be separately reviewed and published on main
by the owner. This sprint does not modify main or environment protection. Existing
main deployment workflow cannot safely perform the required private backup,
full restore and systemd update as written. A main-run diagnostic checkout does
not grant permission to bypass reviewer or to deploy an unreviewed ref.

## Baseline capture (read-only)

Record timestamp, hostname, service identity, systemd unit/drop-ins digest, current
symlink and release SHA, service PID, listening127.0.0.1:3001, health/version,
release/env owner/mode and private environment file digest. Never print env values
or contents. Baseline is /var/www/asi-staging/releases/
5c91b27bcde395f01cc078d1fbe454dd7436e1c6. Preserve it and the existing environment.
Check effective process flags, not only a file: EMAIL_AUTO_SEND=false,
EMAIL_DRAFT_ONLY=true, DRY_RUN_TELEGRAM_OUTBOUND=true,
ALLOW_REAL_TELEGRAM_SYNTHETIC=false, YOOKASSA_ENABLED=false.
Do not inspect unrelated process environments. Abort if anything differs.

## Installation sequence for authorized maintainer

1. Verify target334d93fc exact source/artifact provenance, CI receipts and reviewed
   minimal SQL. Verify baseline and recovery receipts still describe current DB.
2. Apply only independently approved delta under protected staging process.
   Re-query catalog/security/history and preserve all7remote-only definitions.
   Do not reconcile history merely because table names exist.
3. Extract build artifact into a NEW staging release path334d93fc. Validate archive
   paths against traversal/symlink escape before extraction. No old releases removed.
   Preserve asi-runtime user/group and restrictive environment file permissions.
4. Use existing systemd service, existing ExecStart and existing
   /var/www/asi-staging/shared/.env.staging.local. No PM2, no .env.staging.live,
   no new scheduler/provider workers, no production paths or port3000.
5. Before switching, recheck effective no-send flags and durable recovery evidence.
   Atomically update only staging/current symlink, restart only
   asi-landing-staging through authorized host process. Verify effective UID,
   loopback3001, /api/version SHA334d93fc and health. No global kill/restart.
6. Failure: restore current symlink to preserved baseline, restart same service,
   verify baseline version and health. Stop acceptance if rollback fails.
   App rollback does not undo DB changes: DB rollback uses rehearsed recovery,
   never blind DROP of columns containing new data.

## Staging acceptance after all gates pass

Reuse existing G0 harness assertions; do not re-label previous CI as staging.
Create explicit run-scoped synthetic account/property/booking fixture manifest.
Verify all5effective no-send flags before each execution. Exercise intake through
API, durable reservation and operator queue, competing requests/retries/restart,
operator ACK/revision/lease takeover, gated closeout and audit persistence.
Capture exact version, fixture identifiers, expected vs observed state and
negative account/role outcomes. Assert no external calls at the provider boundary
and no sent/payment records attributable to the run. Existing unrelated records
are not evidence of new sends. Cleanup only manifest-owned fixtures after
capturing evidence; do not invoke legacy broad synthetic cleanup RPCs.

Required finish: full restore PASS + minimal delta/security PASS + systemd target
SHA PASS + staging E2E PASS + independently reviewed evidence + rollback PASS.
Offline tests and an approved draft do not satisfy physical staging readiness.
