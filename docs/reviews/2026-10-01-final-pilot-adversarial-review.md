# Final first-pilot adversarial review — 2026-10-01

Verdict: **FIRST PILOT BLOCK**. Operator-assisted mode does not remove the three remaining readiness/clock blockers.

Reviewed branch HEAD: `b402ec655ff590392a015ef4309f7ef1a8e79047`. Code candidate: `e64b0d340f34f9ba227791bbcf33ef707678e136`. Range: `35c6b9eccb65f4f93400a3f06951b4ef1ae32159..e64b0d340f34f9ba227791bbcf33ef707678e136`. HEAD adds only the prior review document. Historical verdict was not reused.

## Remaining confirmed P1 blockers

1. **A different owned property satisfies activation.** `src/lib/ops-v17/service.ts:43-78` gathers ready owned properties; `core.ts:104` compares their count with configured properties. Reproduction: configured-B is unready, ready-A is ready, both owned by A, no completed rentalConnection binding; `activatePilot` succeeds. Fix needed: evaluate each canonical configured target, not an aggregate count; reject unbound targets.
2. **Commercial start bypasses the operational readiness contract.** `src/lib/ru-commercial-pilot/repository.ts:129-133` probes the property card engine, not workspace/intake/explicit operator-mode readiness. Reproduction uses real `computePilotReadiness` with communication disabled, Wi-Fi name but no access instructions, and no workspace/runtime source; real probe plus lifecycle service accepts derive/start and returns pilot_active. Ownership and entitlement are allowed by local mocks. Fix needed: share the account/property operational evaluator between activation and commercial derive/start, including explicit safe manual controls.
3. **Readiness is stale across entitlement claim.** `src/lib/ru-commercial-pilot/service.ts:146-163` caches readiness before awaiting entitlement and reuses it for transition/CAS. Reproduction changes readiness to false inside entitlement callback; start still succeeds. Fix needed: coordinate fresh readiness/ownership validation with the start transition and entitlement recovery; cached pre-await truth is insufficient.

## Confirmed failures fixed locally

4. **Check-in success after failed canonical gate write.** Injecting `{ok:false,error}` from completeGate allowed checked_in projection. Instructions-sent, access-ready and checked-in transitions now reject before projection when that required write fails. Three regressions prove rejection and no execution/record updates.
5. **False closeout after unreadable incident store.** Query failure became an empty issue list and allowed closed. Issue reads now throw; required booking_closed gate failure also rejects before projection. Two regressions cover read outage and gate-write failure. Deposit-return-ready is still insufficient; actual returned/waived confirmation remains required.

## Evidence and limits

Before fixes, five targeted safety assertions failed against the current candidate (four in one run, one closeout run); 35 inherited clone cases were intentionally skipped. These failures reproduced behavior, not import/setup errors. Temporary proof sources are archived at `C:\Users\Admin\asi-overnight-wave0\final-review-evidence`; `locations.json` records original paths. Restore them there and run Vitest with `-t 'final review'` to replay. They are not silently retained as failing default-suite files.

After fixes: checkin-execution-autopilot 14/14 and instay-checkout-autopilot 20/20 PASS (34/34, two files); typecheck PASS. Five new regressions are in the existing suites. Earlier broad/tenancy/PostgreSQL evidence was not rerun or presented as new verification. No live or browser acceptance was performed.

Reviewed operator authorization and before/after-adapter ownership checks, delivery guards, manual/automatic mode distinction and closeout return guard; no additional confirmed finding from those inspections. This is not proof of every possible race or full repository acceptance.

Explicit operator-assisted communication, declared manual/CSV/direct booking intake, document/access/inspection handling and manual deposit-return confirmation can remain pilot controls **after blockers are fixed**. Automatic sending stays blocked without authoritative proof. Pricing, Finance v2, international workflows, telephony and report automation are non-blocking future work.

No push, merge, deploy, production/staging access or changes, live database actions, secrets access, real messages, payment/refund actions or external write APIs were performed. Only local source, mock tests and commits were used.

Final verification: changed-file ESLint PASS; git diff --check PASS. No broad test run was needed for these bounded persistence changes. Remaining three safety assertions are unresolved findings, not green acceptance results.
