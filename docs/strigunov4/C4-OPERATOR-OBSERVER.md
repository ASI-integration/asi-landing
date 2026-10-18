# C4 operator BLOCK: bounded read-only observation, never replay

## Retained incident evidence

[Run 39145734946](https://github.com/ASI-integration/asi-landing/actions/runs/39145734946),
attempt 1, exact source `c3d02873c4810e4d2f585292db80b1a9ef9c04a6`.
[Job 117729096239](https://github.com/ASI-integration/asi-landing/actions/runs/39145734946/job/117729096239):
owner/current-main admission succeeded. Worker step began 16:37:55 UTC and
returned only `{"status":"BLOCK"}` at 16:37:59 UTC on 2026-10-18.
No CONFIG_PASS, ROLLBACK_PASS or manual-recovery receipt was emitted.

The complete downloaded job log has 175 split lines (one additional blank line
may be counted by viewers). Its masked output is retained outside the PR;
no raw environment, key material or host secret is included here.

The outer admission handler includes a fixed message; the observed status-only
receipt is consistent with a remote BLOCK propagated by RemoteOutcome.
On the recorded source all exceptions escaping run_locked/perform collapse
into remote BLOCK. Candidate paths before the protected replacement include:

- run binding, root/host, evidence directory creation/identity, lock open/identity/flock;
- parent paths, unit digest, active service/user/group/path/drop-ins;
- exact EnvironmentFiles string, G0 link, PID, effective duplicate keys/no-send;
- GET health/version/status/JSON/size, PID stability or time budget;
- env file ownership/mode/read race, strict parser, allowlist comparison;
- already configured, existing fixed claim, claim sync, backup or prepared marker.

The protected replacement/recovery section normally returns distinct recovery
codes, making an earlier refusal plausible. It does NOT prove the env was
unchanged: outer cleanup failures can also escape, and no independent snapshot
exists. Both host configuration outcome and fixed claim presence remain UNKNOWN.
The earlier reader accepted EnvironmentFiles path membership; the repair requires
exact formatting. This is a hypothesis, not an established host mismatch.
The exact check remains intact; no acceptance rule is weakened.

## One observer in the existing read workflow

`strigunov4-c4-retained-readonly.yml` gains the explicit scope
`operator-39145734946`. The original retained DB/host jobs are excluded from
that scope. The observer job receives only staging SSH credentials, no database
credential, and reuses the pinned SSH fingerprint and checked stdin transport.
Host, root paths, and fixed systemd unit digest must match before private evidence
is observed. Effective service/G0/no-send/health/version checks reuse the repair
preflight. Failures are bounded source-owned labels; raw exceptions never print.
Unknown errors remain UNKNOWN rather than claiming a safe pre-write outcome.

Only `/root/.asi-strigunov4-operator/incident-39140030546` is inspected.
Directory/file descriptors reject symlinks, unexpected root ownership/modes and
nonregular/multiply-linked marker files. Marker JSON is bounded to 4096 bytes.
Only four fixed filenames are opened. The original private env backup content
is never read: only its regular-file metadata/presence is checked.
No directory enumeration, creation, lock-file creation, backup copying, command
execution from marker data, claim deletion, restart, SQL or login is performed.
No provider call or booking is permitted. GETs are fixed loopback health/version,
without redirects, after effective safety checks. Reads may update filesystem
access times or normal service access logs; no configuration/content is written.

The receipt reports:

- `environmentFiles`: EXACT_EXPECTED / EXPECTED_PATH_OTHER_FORMAT / OTHER;
- `live`: PASS or a fixed BLOCK_REASON_* (including ENVIRONMENT_FILES);
- `envPlan`: CHANGE_NEEDED / ALREADY_CONFIGURED / fixed refusal;
- `membership`: process/file mismatch or fixed operator present/missing when live passed;
- `claim`, `backup`, `prepared`, `success`, `recovery`: coarse observed marker states.

Markers are recorded assertions, not independently verified historical effects.
The snapshot explicitly says NON_ATOMIC_CURRENT_ONLY and historicalWrite UNKNOWN.
A missing claim does not renew a consumed permission or authorize another repair.
C4_OPERATOR_OBSERVED means a diagnostic receipt was obtained, not a healthy host
or a ready pilot. Evaluate each field. UNKNOWN/INVALID forbids mutation/replay.

## Prepared permission; not an executable approval

After protected source merge, resolve actual current main M and require separate
owner permission for ONE read-only host diagnostic, with GitHub staging review:

```text
workflow=strigunov4-c4-retained-readonly.yml
diagnostic_scope=operator-39145734946
reviewed_main_sha=M
incident_run=39145734946
confirm=READONLY_C4_OPERATOR_M
```

M is deliberately not replaced by a guessed future merge SHA. Recheck current
main and all required exact-head evidence before proposing that permission.
No dispatch is authorized by this document or the previous permissions.
Never replay 39145734946, 39140030546 or 39127850376, even if no claim is observed.
Any future change needs a wholly new specifically scoped procedure/permission;
this observer cannot authorize or perform it.

PR #502 remains independent and unmerged pending its exact owner gate. Its source
checks do not prove an installed release, usable human session, physical booking,
cleaning/linen/consumables/readiness, or independent egress acceptance.

## Validation boundaries

Two focused test files retain prior parsing, crash, atomic write and rollback
regressions and add fixed observer/receipt/admission/refusal scenarios (34 cases).
Eleven real temporary-file cases run on isolated Linux CI; Windows skips them.
Ownership is simulated for the non-root CI user; service/network calls are mocked.
These are source proofs, not staging observation. No host operation is executed
by PR checks. Existing incident evidence and prior approvals are preserved.

The existing workflow safety regression also verifies the third protected job,
its separate scope, confirmation and absence of database credentials.
