# G0 batch and worker review corrections

Source review approves the bounded corrections for publication and required exact-head CI. New focused tests are prepared; local execution is not claimed while the owner-machine runner is unavailable.

`runBookingOpsAutomationBatch` previously used Promise.all even though per-record automation now throws on uncertain failure. One failed record therefore hid other records' completed results. It now waits for all outcomes and returns explicit successful `records` and failed `{recordId, code: 'manual_reconciliation_required'}` entries. It does not retry a failed record, release its retained lease, or represent its uncertain write as success. Raw error reasons are not included in the batch result.

Consumer search: GitHub code search of the main baseline found only the declaration; the complete current PR473 patch contains no added caller; searches across all supplied changed-source and subsequent candidate files likewise found only the declaration and the new focused tests. This is an internal unused export, so no known route or existing caller silently receives a changed response shape. The focused three-case suite exercises mixed success/failure, all failures and an empty batch using the real automation lease wrapper with a stateful RPC ledger, proving successful release and failed lease retention.

The two service child processes in the G0 acceptance worker are now registered in its existing cleanup set. The paused child now has the same 120-second SIGKILL bound as the regular service child, preventing an unbounded wait. Existing G0 native CI validates the complete worker; node --check passed for this source correction.

## Retained-lease reconciliation boundary

The review correctly identifies an operational limitation: there is no normal UI operation to reconcile a retained token after an uncertain failure. That does not justify clearing tokens before acknowledgement or expiring them by time. Unknown external completion may still arrive; either action would defeat durable HOLD and permit unsafe takeover/replay.

No token deletion or new privileged endpoint is added here. A future separately reviewed reconciliation operation must establish that the exact worker cannot continue, reconcile any provider-side outcome, bind the action to the exact account/booking/execution and expected state, retain an audit record, and recheck quiescence before acknowledgement. Current uncertain cases remain blocked for explicit manual reconciliation. This is not a claim that automated failure recovery is implemented, nor an extra logical-archive restore requirement.

The pre-check-in correction was independently source-reviewed: canonical booking/property access is checked before identity/readiness access; the verified scope reaches all three readiness reads, and the existing before/after identity comparison still withholds output on a change. The added tests target denied access, canonical scope propagation, changed identity, and domain rejection. This closes a per-property access gap without claiming a demonstrated cross-account leak.
