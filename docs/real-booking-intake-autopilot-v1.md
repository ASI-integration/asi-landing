# Real Booking Intake Autopilot v1 — Audit

## Goal

Turn inbound booking requests into Booking Ops records with full automation stack initialization and safe communication intents — without manual admin clicks to start lifecycle, legal/payment placeholders, check-in/checkout baselines, or task planning.

## Current state (before v1)

### Web intake routes/forms

| Component | Path | Classification |
|-----------|------|----------------|
| Public guest form | `src/app/guest-intake/[token]/page.tsx` | **Semi-automatic** — updates existing booking after operator sends link |
| Guest intake API | `src/app/api/guest-intake/[token]/route.ts` | **Semi-automatic** — token-bound submission only |
| Guest intake inbound | `src/lib/booking-ops/guest-intake-inbound.ts` | **Automatic** for linked session |

**Gap:** No public endpoint to create a new booking from a raw web request.

### Telegram inbound intake

| Component | Path | Classification |
|-----------|------|----------------|
| Owner text import | `src/lib/bookings/owner-telegram-intake.ts` | **Semi-automatic** — owner pastes text, not guest channel |
| Guest intake `source: telegram` | `guest-intake-inbound.ts` | **Missing** — schema supports it, no route |
| Ops Telegram drafts | `telegram-drafts.ts` | **Manual** — operator copies draft |

**Gap:** No internal Telegram guest intake API wired to Booking Ops creation.

### Admin-created booking flow

| Component | Path | Classification |
|-----------|------|----------------|
| Dashboard create | `POST /api/dashboard/booking-ops` | **Semi-automatic** — manual form, then auto core loop |
| `createBookingOpsRecord` | `repository.ts` | **Automatic** — lifecycle + legal placeholders + tasks + intake session |

### booking_ops_records

Base table in `20260627000001_booking_ops_v1.sql` with intake/readiness extensions. **Automatic** on create via repository.

### Guest intake autopilot

`guest-intake-autopilot.ts` — **Automatic** session, token, fallback task, lifecycle hints after record exists.

### Lifecycle initialization

`lifecycle.ts` + `core-loop-initialization.ts` — **Automatic** on record create. All gates seeded; `booking_received` completed.

### Legal/payment initialization

`legal-payment-autopilot.ts` — **Automatic** placeholder rows on core loop init. Real OTA/OkiDoki/MVD — **Missing**.

### Check-in execution initialization

`checkin-execution-autopilot.ts` — **Manual/lazy** — row created on first operator action only.

### In-stay/checkout initialization

`instay-checkout-autopilot.ts` — **Manual/lazy** — same pattern as check-in.

### Ops task generation

`tasks.ts`, `task-sync.ts`, `automation-engine.ts` — **Automatic** after record create/update when dates known. No fake schedule without dates — **Automatic** (eligible=false).

### Communication intent generation

`communication-orchestrator.ts` — **Automatic** drafts after task sync. Risky types stay review-required via `communication-auto-send-policy.ts`.

### Auto-send

Guardrails + scoped actual send — **Opt-in**. Global auto-send OFF in production.

## v1 additions

### Unified intake service

`src/lib/booking-ops/real-booking-intake-autopilot.ts`:

- `normalizeInboundBookingRequest`
- `findOrCreateGuestFromInbound`
- `findOrCreateBookingFromInbound`
- `attachBookingToOwnerProperty`
- `initializeBookingAutomationStack`
- `queueInitialBookingCommunications`
- `getInboundBookingIntakeStatus`
- `processInboundBookingRequest`

### Idempotency table

`booking_inbound_intake_events` — unique `idempotency_key`, status tracking, duplicate linkage.

### APIs

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/booking-ops/intake/web` | Public + rate limit | New web requests |
| `POST /api/internal/booking-ops/intake/telegram` | Bearer secret | Telegram bot hook |
| `POST /api/dashboard/booking-ops/intake/process` | CRM ops admin | Process / actions |
| `GET /api/dashboard/booking-ops/intake/status` | CRM operator | Status by booking |
| `GET /api/dashboard/booking-ops/intake/events` | CRM operator | Event list |

### Dashboard UI

Section «Входящие заявки» on `/dashboard/booking-ops`.

## Classification summary

| Area | Before v1 | After v1 |
|------|-----------|----------|
| Web → new booking | Missing | **Automatic** |
| Telegram → new booking | Missing | **Automatic** (internal) |
| Admin → new booking | Semi-automatic | **Automatic** via intake service |
| Duplicate protection | Missing | **Automatic** |
| Lifecycle init | Automatic on create | **Automatic** |
| Legal/payment placeholders | Automatic on create | **Automatic** |
| Check-in/checkout baseline | Manual/lazy | **Automatic** baseline rows |
| Pre-checkin recompute | On demand | **Automatic** on intake |
| Safe comm intents | Partial | **Automatic** acknowledgement + missing data |
| Risky comm intents | Review-required | Unchanged — **review-required** |
| Real message send | Opt-in scope | Unchanged — **no global auto-send** |

## Still manual after v1

- Operator sends guest intake link for document collection
- Contract/deposit/MVD real-world steps
- Access instructions with secrets
- OTA/channel-manager API import
- Payment provider / OkiDoki / MVD export
- Attaching property when unknown (operator action or attach API)
- Approving review-required communications
- Enabling scoped actual auto-send
