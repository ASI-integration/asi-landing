# G0 scope-before-HOLD independent review

**Verdict: approve the scoped application fix for publication and CI.** This addresses a real authorization ordering defect; it is not a mock-only workaround. No database operations were performed for this review.

The previous `held(event)` copied a booking ID from an account-scoped receipt before validating the linked booking. Forced/non-process actions, mismatched request fingerprints and incomplete execution could return early. Filtering the receipt by account does not prove the referenced booking belongs to that account. The completed status-read branch had the same unchecked-reference issue.

The reviewed candidate introduces `verifiedReceiptBooking`, validating account and property before any linked identity is exposed. It catches only lookup failures and returns no verified identity on missing/read-uncertain results. Account/property assertions remain outside that catch, so detected foreign references still fail with `account_scope_mismatch`. The process path validates before force/fingerprint/incomplete HOLD decisions, returns redacted booking/guest IDs on HOLD, and reuses the verified booking on duplicate handling. Completed status now validates the linked booking; its guest ID is redacted, and duplicateOfBookingId is returned only if it equals the verified linked ID. Incomplete status reuses its first validated lookup, avoiding a redundant read.

This preserves durable HOLD and manual reconciliation for uncertain writes; it neither authorizes retries nor treats a reserved ID as confirmed. Control flow returns or rejects before receipt admission and automation side effects in these cases.

The implementing agent reports the exact candidate's focused suite **13/13 PASS**, with touched-file ESLint exit0. Independently read tests cover foreign running/completed receipts, force, wrong canonical property, completed status, missing linked booking and a thrown lookup, plus the existing canonical create-path cases. Negative scope tests assert no booking create/update/check-in initialization; uncertain-read tests assert no creation. Broader no-call assertions were suggested but are not an additional gate: the reviewed early-return control flow precedes the other automation/hold/task/event calls. This verdict does not claim live integration or global G0 acceptance; repository CI remains required.

| Reviewed candidate | SHA-256 |
| --- | --- |
| `real-booking-intake-autopilot.ts` | `e1acd044ae3254a6f50e6402c89472ba89451c754364ed6ac233493a327201d6` |
| `channel-manager-create-path-isolation.test.ts` | `287d53c03ab146fc77ed329743de0e3e98bca9433a83fd3251ae99ebab57e72c` |

## Subsequent test-mock type correction

The compiler identified that optional chaining in the test RPC mock's token comparison did not establish a defined record for its mutation. The mock now requires `record && record.automation_token === args.p_token` before clearing the token. This narrowly guards the synthetic mock, changes no production code and preserves the tested lease semantics. The production SHA-256 above is unchanged; the test SHA-256 reflects this correction. The 13/13 focused execution and ESLint result precede this final mock guard; the required TypeScript check subsequently passed for the final revision (process2552, exit0). No additional test run is claimed here.
