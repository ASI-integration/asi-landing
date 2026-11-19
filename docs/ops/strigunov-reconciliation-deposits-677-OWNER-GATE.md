# #677 — Contracts, escrow deposit events and OTA → bank → owner reconciliation

**Status:** review-only, source-only financial P0 implementation. No actual signing, charging, refund, bank/OTA integrations, or MVD dispatch. The original shared Supabase and production staging are never modified by this branch.

## Contract rule source of truth
\`reconciliation-deposits-677.ts\` requires exactly one effective rule for the booking date, with known commission, tax, owner-share and OTA/direct collection model. No inferred rates or international currency conventions. Version date ranges use \`[validFrom, validUntil)\` so a booking on a version boundary selects exactly one rule. The draft hash commits to the exact version and contract text; a draft is not a signed contract.

\`computeBookingSettlement677\` calculates with **BigInt integer kopecks** and half-even rounding. The result separately exposes the gross expected from the booking, expected bank receipt, provider commission and tax amounts, and the owner payable. These values are *accrued/expected*, not bank-cleared by themselves.

## Deposit escrow (no charge)
\`requested_no_charge\` is a safe request state with no payment. A transition to \`received_bank_verified\`, \`retained_partially\`, \`retained_fully\` or \`refunded_bank_verified\` requires a bank reference and evidence hash. The state machine rejects duplicates, over-receipts, excessive holds/refunds and impossible partial/full retention. The cash holding and retention/refund must be represented in corresponding immutable double-entry journals by a separately reviewed write adapter; **the pure core does not automatically insert bank evidence or pay funds**.

## Independent bank/OTA/owner verification
\`reconcileThreeWay677\` compares a versioned booking calculation against **posted bank statement lines** with transaction IDs, provider ID, statement ID, currency, booking scope and evidence hash. Replayed statement lines are not counted twice. Owner payouts are computed from a **separate set of posted, evidence-bearing bank lines**, not an unverified number supplied by a caller. Pending/late, partial, overpaid and missing bank evidence generate manual-review reasons. An outstanding owner payout is not falsely marked paid.

The SQL DRAFT includes an append-only booking/tenant-scoped contract version table, contract draft table, deposit events, unique bank statement lines, double-entry journals, immutable period closures, and a manual discrepancy inbox. Deferred journal-balance validation rejects nonzero imbalance. Ledger updates/deletes are blocked by triggers, including for service_role; historical closed-month journal INSERT is blocked and must be corrected by a separately evidenced reversal in an open period. No finance table ACL for \`anon\` or \`authenticated\`; \`service_role\` gets SELECT/INSERT only.

**Limitations / next approval:** this is a candidate schema and pure financial calculator, not a fully integrated G2–G6 transaction runner or PDF contract signature provider. Real bank verification, OTA act parsing, independent immutable evidence-chain signing, calendar/revenue account reconciliation, ledger posting adapter and manually approved write-off execution still require reviewed integration. No live provider credentials or billing changes.

## Reproduction and rollback
Focused Vitest: \`npx vitest run src/lib/booking-ops/__tests__/reconciliation-deposits-677.test.ts\`.
TypeScript: \`npm run typecheck\`. Lint the two touched TS files.

SQL fixture: concatenate \`DRAFT.sql\` without its own \`BEGIN/COMMIT\`, plus \`ROLLBACK-TEST.sql\`, in **one outer** \`BEGIN; ... ROLLBACK;\` on the existing verified isolated PostgreSQL 17.11 \`asi_shadow_migrations_test\`. Verify both new table and synthetic users are absent after rollback. No permanent deployment. All synthetic bank references use example IDs; none are bank-provider receipts.

**PR policy:** Draft/independent security review, then protected GitHub CI and owner-gated migration. Neither this branch nor passing fixture tests authorize protected merge or shared Supabase modification.
