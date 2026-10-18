# C4: protected repair of the observed operator admission failure

## Observed evidence, not historical inference

Approved read-only run [39140030546](https://github.com/ASI-integration/asi-landing/actions/runs/39140030546)
used main `06cd7690665470d521abcea729391241acf98174`, attempt 1.
Its permission is consumed; neither it nor writer 39127850376 may be replayed.

- [Database job 117712839070](https://github.com/ASI-integration/asi-landing/actions/runs/39140030546/job/117712839070):
  C4_RETAINED_READONLY_OBSERVED / NO_ROWS_OBSERVED, no booking/intake candidates,
  no scope block codes. Old identities [1,1,1,1,0] and known counts match.
- [Host job 117712838905](https://github.com/ASI-integration/asi-landing/actions/runs/39140030546/job/117712838905):
  HOST_FRESH_OPERATOR_NOT_CONFIGURED. Earlier host/release/unit/process/env-mode
  checks and all seven effective safety invariants passed. Health/version were
  after the failing condition and were NOT checked by this run.
- Current absence of new rows is not proof the writer never wrote.
  Historical full-row preservation and independent egress remain unproven.
  This fixes the observed current host gate, not a proven historical root cause.

## Minimal candidate; no server operation authorized

The old no-send installer only adds ASI_SYNTHETIC_NO_SEND on its pinned old release.
The general staging deploy workflow builds/installs a release and uses a different
acceptance identity. Neither is an authorized equivalent of this narrow repair.

The new [workflow](../../.github/workflows/strigunov4-c4-operator-repair.yml) and
[protected transport](../../scripts/strigunov4/protected_c4_operator_repair.py)
admit one fixed synthetic email:
`c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local`.
Only CRM_OPERATOR_EMAILS and OPS_ADMIN_EMAILS in
`/var/www/asi-staging/shared/.env.staging.local` may change.
Existing members remain, case-insensitive duplicates are removed, no other
setting bytes change. The strict parser rejects ambiguous/multiline/escaped
syntax and duplicate safety or allowlist assignments instead of guessing.

Admission pins exact current main, workflow, owner login/ID, first run attempt,
incident 39140030546, protected staging reviewer, SSH identity/fingerprint,
host asi-agent-runner, G0 d912aec6663de90e5ca4293cc5a69e2e0ed9ff94,
unit digest, service/user/group/path, exact sole EnvironmentFile,
env UID1001/GID1000/mode0640, all seven stored and effective no-send invariants.
No database credential is supplied. No login/dashboard POST/provider call,
SQL, migration, release switch or production operation is implemented.

The worker reuses existing atomic file and bounded-command helpers without
changing the old installer. It checks effective lists equal the parsed baseline
and verifies loopback GET health/version before the first env replacement.
Redirects are refused. After restart it checks exact membership sets, seven
flags, same G0, health/version, stable PID, and unchanged planned env bytes.

A root-private lock and permanent fixed incident claim prevent a second apply,
even with a different run ID/SHA. The original file is saved privately with
mode0600, under a mode0700 directory. No hashes of secrets or env values are
printed. Partial/crashed attempts retain their claim and original evidence.
Pure planning is idempotent; an already configured live attempt stops without
restarting. Nothing automatically clears the claim or authorizes a retry.

## Owner decision after reviewed merge

At the resulting exact current main M, authorize only this one configuration
addition, its private backup/journal, one staging restart and conditional recovery.
The confirmation input is a guard, not approval:

```text
workflow=strigunov4-c4-operator-repair.yml
reviewed_main_sha=M
incident_run=39140030546
confirm=CONFIGURE_C4_OPERATOR_M
```

Only staging SSH secret names are used: STAGING_SSH_HOST, STAGING_SSH_PORT,
STAGING_SSH_USER, STAGING_SSH_PRIVATE_KEY. Values stay in the protected job.
Check no existing run consumed the approval; dispatch once; the owner must then
use Review deployments -> staging. No admin bypass or self-approval by the agent.
The current preparation and earlier read-only approval authorize none of this.

Expected downtime: brief staging interruption for service restart. Allow up to
230 seconds for preparation/activation and reserve 155 seconds for recovery
(total worker budget385; SSH465; job600 seconds). This is a timeout ceiling,
not a guarantee of recovery after host loss.

On a catchable failure after possible replacement, restore original bytes only
if current bytes equal the exact proposal, restart the same service and verify
the prior effective sets, seven no-send flags and G0 health/version.
Concurrent unknown file changes are never overwritten.
ROLLBACK_PASS is failure of the repair, not pilot readiness.
Lost transport, unrecoverable failure or uncatchable crash means
BLOCK_MANUAL_RECOVERY_REQUIRED / STOP_AND_RETAIN; no rerun or cleanup.
Application rollback cannot undo any independent database/background effects.

## Evidence boundaries and next steps

C4_OPERATOR_CONFIG_PASS proves the checked host configuration only.
The tool invokes no DB client, but does not observe the database across restart;
its receipt explicitly says databaseState=NOT_OBSERVED. A claim of unchanged
database requires separately scoped evidence, not an invented zero.
Independent network evidence and a usable human operator session remain required.

PR502 fixes nine automatic GET paths but is not installed by this patch. Its
updated reviewed head is da286c0dbc40ec3b426f92807d1c6c40c5c0d2fd.
The old G0 installer/physical gates pin the previous release: a new reviewed
immutable release and separately approved activation are still needed for UI
acceptance of that fix.

The fixed operator here belongs to the consumed incident identity. This repair
does not authorize reuse of its roots or another physical test. A later fresh
fixture requires its own identity/admission plan, write permission, retention
and protected approval. Do not silently substitute a different email here.

Tests: two files, 30 cases. Nine actual atomic-file/recovery cases run on Linux;
Windows skips those explicitly. All service and network interactions in tests
are simulated, never live host acceptance. CI also runs normal required checks.
