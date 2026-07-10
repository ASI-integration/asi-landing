# OPS v14 Package B - Telegram Owner Booking Signals to Modern Intake

Date: 2026-07-10

## Scope

Package B wires Telegram owner/operator booking-like text into the modern booking intake path.

Not included: Package C operator visibility, Package D controlled send path, UX copy/layout changes, broad Telegram routing refactors, guest support booking creation, provider integrations, or location/scoring changes.

## What Now Routes to Modern Intake

Inbound Telegram text that reaches the owner/manager onboarding route and clearly looks like a booking signal now calls `processInboundBookingRequest(..., 'telegram')`.

Allowed signals are owner/operator-style booking messages that include booking vocabulary such as booking, check-in/check-out, guest, Avito/Sutochno, plus at least one stronger signal such as a date, contact phone, or enough booking-like detail.

The route reuses the existing text import parser only to extract candidate fields, then passes the result into modern intake. Creation, lifecycle initialization, missing-field status, guest intake, task sync, communication intents, and Package A summary compatibility all stay owned by the modern booking-ops intake path.

## Allowed Roles

Routed:

- Telegram owner
- Telegram manager/operator in the existing owner onboarding path
- Lead messages only when they are already being handled by the owner onboarding path and match booking intent

Not routed:

- Guest support messages
- Unknown identity messages before role selection
- Non-booking owner messages
- Ambiguous operational/support messages without booking intent

## What Remains Manual

Ambiguous owner text that does not clearly represent a booking continues through existing owner onboarding/manual handling.

Partial booking requests are not force-completed. They create or update the modern intake record with missing fields, then use the existing missing-data/review path (`needs_review`, next required actions, guest intake/session/communication sync as applicable).

No new auto-send behavior was added. Any outbound Telegram behavior remains the existing intended reply/draft behavior.

## Idempotency

Telegram message identifiers from the orchestrator (`inboundIdempotencyKey`, `providerMessageId`, or `externalMessageId`) are passed as the modern intake `sourceMessageId`.

Modern intake now treats a retry with the same idempotency key and an existing booking record as `duplicate`, including partial `needs_review` intake events. This prevents duplicate booking records when Telegram retries the same event.

If a Telegram event arrives without any message identifier, the helper falls back to a stable key built from channel, chat id, and message text. This is less precise than Telegram message ids but still safer than a random key for owner booking signals.

## Tests Run

```bash
npx.cmd vitest run src/lib/bookings/__tests__/owner-telegram-intake.test.ts src/lib/booking-ops/__tests__/real-booking-intake-autopilot.test.ts src/lib/bookings/__tests__/text-import.test.ts
npm.cmd run typecheck
npx.cmd eslint src/lib/bookings/owner-telegram-intake.ts src/lib/bookings/__tests__/owner-telegram-intake.test.ts src/lib/booking-ops/real-booking-intake-autopilot.ts src/lib/booking-ops/__tests__/real-booking-intake-autopilot.test.ts
```

The broader `src/lib/communication/__tests__/communication-identity-routing.test.ts` file was checked during implementation, but it currently fails on unrelated owner-onboarding copy/state expectations around the channel-manager wizard. No Package B code or assertion changes were kept in that file.

## Known Remaining Gaps for Package C

- CRM queue still does not show booking-domain intake signals as a first-class queue.
- Operator visibility remains split between CRM/owner onboarding and Booking Ops intake events.
- No new cross-link or dashboard widget was added for active booking intake records.
- Legacy dashboard text import remains available outside the demo path.
