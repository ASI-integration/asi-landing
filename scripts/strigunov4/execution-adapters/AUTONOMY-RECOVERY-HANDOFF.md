# Ground Zero / Stage 4 — recovery and owner visibility (source only)

## Existing infrastructure, do not duplicate

The real Beget runner is **asi-strigunov-agent.service**. It is installed as
one enabled systemd service with an existing Engine lock and protected
/var/lib/asi-engine. The original Engine writes an IDLE/FAILED_LOCKED journal,
receipts.json, report files with SHA256, and heartbeat.json. The owner already
has a separate GPS / Mission Control dashboard; do not deploy another API,
scheduler, dashboard service, queue or root agent.

## What the new evaluator does

- autonomy-recovery-observer.mjs is a pure, read-only **evidence evaluator**,
  NOT a privileged export or assertion of authenticated runtime identity.
- inspectEngineRestart compares two authorized host snapshots. It checks distinct
  PID and systemd InvocationID, nonregressing restart counter, unchanged
  persisted receipts/budget/routing hashes and identical terminal receipt
  identity. It independently hashes the provided report bytes, checks the
  original task binding and GITHUB_PR_VERIFIED identity. Unknown or tampered
  evidence blocks; no restart returns RESTART_NOT_OBSERVED.
- projectObservedFiveLanes uses fixed OWNER_LANES from existing code. Without
  a matching catalog task it reports BLOCKED; stale, absent, or foreign-process
  heartbeat returns UNKNOWN. Even fresh input yields OBSERVED_RUNNING/IDLE,
  never physically VERIFIED or an authority grant.

All successful results are marked verified:false, physicalAcceptance:false.
An independent authorized host operator must authenticate the source of
the snapshots and report bytes before the owner can rely on them. A copied
blob/PR/GitHub CI is NOT a trusted physical witness.

## Integration and physical acceptance remaining

1. Finish #552's standing authority and #556's signed five-lane catalog;
   #567 source intake is also not a live autonomous coder.
2. Add a narrow, read-only, **service-UID/authorized-operator** evidence
   export from existing protected state. Do not chmod/chown /var/lib/asi-engine,
   do not bypass sudo/command allowlists, do not include API keys/tokens,
   private reports or customer data in dashboard responses.
3. Feed only **authenticated redacted evidence** into existing GPS/Mission
   Control. Bind five status rows to the current systemd PID/InvocationID
   and check heartbeat freshness, task ID, PR/CI and receipt hashes.
4. After verified G2 two-task receipts and IDLE, obtain a **separately
   authorized controlled restart** of only the existing Engine. Before/after
   compare service identity and exact protected report, receipts, budget and
   routing hashes. Verify no re-publication of PR #564/#565 and that old
   writer #531 remains untouched.
5. On actual signed five-lane Engine run, test fresh task selection and
   recovery after controlled restart with no replay or budget refund.
   Physical completion requires this real host proof, not fixture PASS.

**31 Oct checkpoint:** source tests 12/12 PASS. Real systemd unit was active,
enabled, PID 387356, NRestarts 0; no actual controlled restart in this change.
No secrets, privileges, systemd, GitHub protected main, signed authority,
security baseline or live product data were changed by the evaluator.
