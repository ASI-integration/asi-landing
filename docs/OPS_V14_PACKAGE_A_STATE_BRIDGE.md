# OPS v14 Package A - Booking State Bridge + Close Guards

Date: 2026-07-10

## Scope

Package A implements the state bridge and close guards from `docs/OPS_V14_END_TO_END_GAP_AUDIT.md`.

Not included: Package B intake connectivity, Package C operator visibility, Package D controlled demo send path, UI copy/layout changes, new provider integrations, or broad data-model refactors.

## What Was Bridged

Legal v1 remains the source of truth for:

- `booking_guest_documents`
- `booking_contracts`
- `booking_deposits`
- `booking_mvd_reports`
- `booking_guest_legal_readiness`
- lifecycle gates owned by legal v1, such as `documents_verified`, `contract_signed`, `deposit_received`, and `mvd_report_submitted`

`booking_ops_records` remains a summary/read model for booking tasks, communication planning, readiness, and operator lists.

After every `recomputeGuestLegalReadiness()` call, the bridge now syncs legal v1 readiness into these summary fields:

- `booking_ops_records.documents_status`
- `booking_ops_records.contract_status`
- `booking_ops_records.deposit_status`
- `booking_ops_records.mvd_status`

The bridge is idempotent. If the summary already matches legal v1 readiness, no record update is issued. If it changes, the existing `updateBookingOpsRecord()` path is used so task/readiness/communication sync continues through the established repository flow. No messages are auto-sent.

## Status Mapping

Document state:

- `verified` -> `verified`
- `received`, `partially_received` -> `received`
- `requested` -> `requested`
- `needs_review`, `rejected`, `blocked` -> `problem`
- everything else -> `not_started`

Contract state:

- `signed_manual`, `signed_provider_placeholder` -> `signed`
- `sent_for_signature_placeholder` -> `sent`
- `draft_ready` -> `prepared`
- `needs_review`, `blocked` -> `problem`
- everything else -> `not_started`

Deposit state:

- `paid_manual`, `paid_provider_placeholder`, `waived_manual` -> `confirmed`
- `request_draft_ready`, `requested_placeholder`, `pending` -> `requested`
- `failed`, `disputed`, `blocked` -> `problem`
- everything else -> `not_started`

MVD/reporting state:

- `not_required` -> `not_required`
- `submitted_manual`, `submitted_provider_placeholder`, `accepted_manual` -> `submitted`
- `draft_ready`, `export_ready` -> `prepared`
- `rejected`, `needs_review`, `blocked` -> `problem`
- everything else -> `required`

## Close Guard Rules

`markBookingClosed()` now runs server-side prerequisite validation before completing `booking_closed`.

Closure is blocked when any modeled prerequisite is incomplete:

- guest name is missing
- guest contact is missing
- property is missing
- check-in/check-out dates are missing
- guest count is missing
- required documents are not verified
- required contract is not signed
- required deposit is not collected or waived
- required MVD/reporting state is incomplete
- `guest_checked_in` is incomplete
- `guest_checked_out` is incomplete
- `post_checkout_inspection_done` is incomplete
- required deposit return/resolution is not ready
- active stay issues remain open, triaged, assigned, or blocked

Before legal checks, the guard calls `recomputeGuestLegalReadiness()` so stale summaries get one final bridge pass. If legal readiness cannot be checked, closure is blocked with `legal_readiness_unavailable`.

Failures throw `BookingClosePrerequisiteError` with:

- `code: "booking_close_prerequisites_incomplete"`
- `missingPrerequisites: [{ key, category, message }]`

The dashboard instay-checkout API preserves this structured list in the JSON response and returns HTTP 400. Successful close paths still complete `booking_closed` and set the in-stay checkout execution to `closed`.

## Known Remaining Gaps

Package B:

- Telegram/communication booking signals are still not wired into the modern booking intake entry point.
- Legacy text import and manual/dashboard intake paths are still separate.

Package C:

- CRM queue still does not become a booking-domain queue.
- Operator visibility remains Booking Ops first; no new CRM booking widget/link was added.

Unmodeled or external prerequisites:

- Real payment return rails are not modeled.
- Real e-sign provider status is not integrated.
- Real MVD provider/API status is not integrated.
- Guest document upload portal is still outside this package.
- No new public UI surface was added for raw diagnostic/legal internals.

## Commands Run

Passed:

```bash
npx.cmd vitest run src/lib/booking-ops/__tests__/guest-legal-deposit-mvd-execution.test.ts src/lib/booking-ops/__tests__/instay-checkout-autopilot.test.ts
npm.cmd run typecheck
npx.cmd eslint src/lib/booking-ops/guest-legal-deposit-mvd-execution.ts src/lib/booking-ops/instay-checkout-autopilot.ts src/lib/booking-ops/__tests__/guest-legal-deposit-mvd-execution.test.ts src/lib/booking-ops/__tests__/instay-checkout-autopilot.test.ts src/app/api/dashboard/booking-ops/instay-checkout/route.ts
```

Results:

- Focused Vitest: 2 files, 31 tests passed.
- Typecheck: passed.
- ESLint on touched files: passed.

Not run:

- `scripts/booking-ops-v13-full-lifecycle-acceptance.mjs`

Reason: it requires a live app server at `http://127.0.0.1:3000` plus Supabase/session environment. No server was responding locally, and a temporary dev-server attempt did not become reachable within the readiness window. No heavy build was run.
