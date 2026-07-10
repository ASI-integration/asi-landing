# OPS v14 Package D - Cleaning, Linen, and Readiness Gate v1

Date: 2026-07-10

## Scope

Package D adds a minimal post-checkout readiness loop for cleaning, linen, and inspection/readiness confirmation.

Not included: auto-send behavior, broad staff management, cleaner scheduling, CRM mutations, Booking Ops redesign, provider integrations, or future Package E/F work.

## Readiness States

The Package D gate uses these computed states:

- `not_ready`
- `cleaning_required`
- `linen_required`
- `inspection_required`
- `ready`

These states are computed in `src/lib/booking-ops/readiness-gate.ts` from existing Booking Ops task records and the existing `unit_readiness_status` summary field.

The persisted Booking Ops summary still uses the existing values:

- `not_ready`
- `cleaning_pending`
- `linen_pending`
- `inspection_pending`
- `ready`
- `blocked`

Package D maps the computed gate state back to that existing summary field. No new broad table or scheduling model was added.

## Cleaning, Linen, and Inspection Behavior

Checkout completion now triggers the existing task sync path via `syncBookingOpsTasksForRecordId()`.

The readiness gate treats the post-checkout loop as incomplete until:

- cleaning has a completed `cleaning_done` task;
- linen has a completed `linen_replaced` or `laundry_return_needed` task;
- inspection/readiness has a completed `unit_inspection_needed`, `inspection_needed`, `unit_ready_for_next_guest`, or `unit_ready_confirmation` task.

Completing cleaning alone keeps the property blocked at `linen_required`. Cleaning plus linen keeps the property blocked at `inspection_required`. Cleaning plus linen plus inspection marks the Package D gate `ready`.

## Idempotency

Task creation continues through the existing `createBookingOpsTask()` / `applyBookingOpsTaskSync()` path.

That path already deduplicates open tasks by booking record and task type, and does not reopen completed or cancelled tasks. Package D keeps that behavior. Repeated task sync after checkout does not duplicate cleaning or linen tasks.

## Check-In Readiness Gate

Check-in execution now has a structured readiness prerequisite error:

- `CheckinReadinessPrerequisiteError`
- `code: "checkin_readiness_prerequisites_incomplete"`
- `missingPrerequisites: [{ key, title, message }]`

The guard uses the existing pre-check-in snapshot, so legal, physical readiness, lifecycle, and task blockers remain aggregated in one place.

These check-in actions are blocked when readiness is incomplete:

- prepare instructions
- queue instructions
- mark instructions sent
- mark access ready
- mark guest checked in

The API route preserves the structured prerequisite list and returns HTTP 400 for this blocker. This is a server-side gate; it is not a UI-only disable.

## CRM Signal Integration

The Package C booking signal selector now surfaces readiness blockers read-only in CRM:

- `cleaning_required`
- `linen_required`
- `inspection_required`
- `property_not_ready`

Closed/completed bookings still do not emit active blocker signals.

CRM remains read-only for booking blockers. Operators still resolve readiness in Booking Ops and existing task/check-in APIs.

## What Remains Manual

- Assigning a cleaner or laundry provider.
- Actual cleaning work.
- Actual linen pickup/drop-off/return.
- Operator inspection and readiness confirmation.
- Sending any Telegram/email/SMS messages related to the readiness loop.
- External OTA/PMS updates for readiness.

## Intentionally Not Implemented

- No auto-send.
- No staff roster or scheduling system.
- No broad CRM redesign.
- No Booking Ops redesign.
- No provider integration for laundry, cleaners, OTA, payments, e-sign, or MVD.
- No raw diagnostic exposure in public UI.

## Tests Run

Passed:

```bash
npx.cmd vitest run src/lib/booking-ops/__tests__/readiness-gate.test.ts src/lib/booking-ops/__tests__/turnover.test.ts src/lib/booking-ops/__tests__/tasks.test.ts src/lib/booking-ops/__tests__/checkin-execution-autopilot.test.ts src/lib/booking-ops/__tests__/instay-checkout-autopilot.test.ts src/lib/crm/__tests__/booking-signals.test.ts
npm.cmd run typecheck
npx.cmd eslint src/lib/booking-ops/readiness-gate.ts src/lib/booking-ops/tasks.ts src/lib/booking-ops/turnover.ts src/lib/booking-ops/checkin-execution-autopilot.ts src/lib/booking-ops/instay-checkout-autopilot.ts src/lib/crm/booking-signals.ts src/app/api/dashboard/booking-ops/checkin-execution/route.ts src/lib/booking-ops/__tests__/readiness-gate.test.ts src/lib/booking-ops/__tests__/turnover.test.ts src/lib/booking-ops/__tests__/tasks.test.ts src/lib/booking-ops/__tests__/checkin-execution-autopilot.test.ts src/lib/booking-ops/__tests__/instay-checkout-autopilot.test.ts src/lib/crm/__tests__/booking-signals.test.ts
npx.cmd vitest run src/app/api/dashboard/booking-ops/__tests__/route.test.ts
```

Results:

- Focused readiness/task/check-in/CRM Vitest: 6 files, 50 tests passed.
- Focused Booking Ops API route Vitest: 1 file, 10 tests passed.
- Typecheck: passed.
- ESLint on touched files: passed.

Not run:

- Broad `npm test`.
- Heavy build.
- Location golden tests.

Reason: AGENTS.md limits the default budget to typecheck, touched-file ESLint, and focused tests.

