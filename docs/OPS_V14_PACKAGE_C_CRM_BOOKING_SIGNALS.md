# OPS v14 Package C - CRM Booking Signals

Date: 2026-07-10

## Scope

Package C surfaces minimal read-only booking operational signals inside the CRM hub queue.

Not included: Package D controlled send path, auto-send behavior, broad CRM redesign, booking/CRM identity merge, new booking lifecycle model, or mutations from CRM.

## What Booking Signals Are Surfaced

The CRM queue API now returns `bookingSignals` alongside the existing owner/lead queue payload.

Each signal is derived from one active `booking_ops_records` row and shows the highest-priority blocker for that booking:

| Signal kind | When it appears |
|-------------|-----------------|
| `incident_blocker` | Booking blocked, problem signals, or open in-stay guest issues |
| `checkin_blocked` | Check-in instructions/readiness not ready, arrival soon with incomplete steps |
| `checkout_due` | In-stay checkout flow needs operator attention |
| `closure_blocked` | Booking close prerequisites or in-stay closure blockers remain |
| `documents_incomplete` | Guest documents not requested/received/verified |
| `contract_incomplete` | Contract not signed |
| `deposit_incomplete` | Deposit not confirmed |
| `mvd_incomplete` | MVD/reporting not submitted when required |
| `missing_guest_data` | Booking readiness reports missing booking/guest data |
| `intake_needs_review` | Guest intake fallback or intake without property |
| `recent_booking` | Informational signal for fresh `created` bookings with no blockers |

Closed/completed bookings do not emit active blocker signals.

## Fields And Helpers Used

Primary source: `booking_ops_records` via `listBookingOpsRecords()`.

Selector: `src/lib/crm/booking-signals.ts`

Reused booking helpers:

- `computeBookingOpsAlerts()` from `src/lib/booking-ops/alerts.ts`
- `BookingOpsRecord.readiness` attached by repository enrichment
- `BookingOpsRecord.guestIntake` for intake fallback / missing data
- `getInStayCheckoutStatus()` for post-check-in checkout/incident/closure signals on bookings with check-in in the past (batched, max 40 rows)

CRM identity linking uses exact match on normalized guest phone, email, or Telegram against `crm_contacts`. Ambiguous or unmatched bookings still appear as unlinked signals.

## Priority

Deterministic priority per booking:

1. `incident_blocker`
2. `checkin_blocked`
3. `checkout_due` / `closure_blocked`
4. `documents_incomplete` / `contract_incomplete` / `deposit_incomplete` / `mvd_incomplete`
5. `missing_guest_data` / `intake_needs_review`
6. `recent_booking`

Within the same priority, higher severity wins (`critical` > `warning` > `info`), then earlier check-in date.

## CRM Display

Surface: `/dashboard/crm/queue`

Section: **Сигналы по броням**

Each card shows:

- booking reference and guest/property display name
- severity/title
- CRM link status (linked contact or unlinked)
- reason and next recommended operator action
- read-only link to `/dashboard/booking-ops`

Deep link: CRM cards and operator alerts open `/dashboard/booking-ops?bookingId=<ops-record-id>` (optional `&focus=`). Booking Ops selects that record on load and scrolls to the matching section when `focus` is present.

Existing owner/lead queue columns, filters, operator inbox, metrics, and archive behavior are unchanged.

## What Remains Manual

- All booking actions still happen in Booking Ops (or existing APIs); CRM signals are read-only.
- Telegram draft copy/send remains operator-driven.
- CRM/contact merge and broad identity resolution are not implemented.
- Post-check-in signals depend on optional in-stay snapshot fetch; bookings before check-in use alert/readiness signals only.

## Intentionally Not Implemented

- Package D scoped auto-send
- CRM mutations for booking records
- New booking lifecycle taxonomy
- Booking Ops page auto-selection by `bookingId` query param
- Full CRM/booking record merge
- OTA/payment/e-sign/MVD provider integrations

## Tests Run

```bash
npx.cmd vitest run src/lib/crm/__tests__/booking-signals.test.ts src/app/api/dashboard/crm/queue/__tests__/route.test.ts src/lib/crm/__tests__/queue.test.ts
npm.cmd run typecheck
```

Focused coverage:

1. incomplete documents -> CRM signal
2. deposit incomplete -> CRM signal
3. missing guest data / intake needs review -> CRM signal
4. closed/completed booking -> no active blocker signal
5. unlinked booking still appears
6. deterministic priority ordering
7. existing CRM queue route behavior preserved

## Known Remaining Gaps (Package D / Future)

- No per-booking deep link from CRM into a pre-selected Booking Ops detail panel
- No CRM actions to resolve booking blockers inline
- No unified operator inbox mixing owner onboarding and booking blockers into one sort order
- No batch pre-checkin blocker panel reuse inside CRM (still lives in Booking Ops)
- Package D controlled auto-send path remains separate
