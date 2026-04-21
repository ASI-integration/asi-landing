## Channel Manager Foundation / Distribution Runtime Phase 1

This phase introduces the **foundational backend distribution runtime** for ASI’s built-in channel manager:

- Connect a property to a distribution channel (Booking.com / Expedia / Airbnb, etc.)
- Store channel account configuration (credentials/config container)
- Store listing + rate plan mappings (internal keys ↔ external IDs)
- Ingest reservations/changes/cancellations from channels (webhooks)
- Store availability + base rates snapshots (write path + audit)
- Provide **explicit auditability** for what happened and when
- Provide **safe operational controls** (disable connection, manual resync trigger)
- Add **retry + idempotency primitives** so provider retries don’t double-apply

**Out of scope (explicit):**
- Any “smart OTA optimization” / profitability optimization
- Automatic channel pruning or “optimize channel mix”
- Provider-specific business logic for pricing strategy

### Canonical model (Phase 1)

Important: the repo already has `channels` (telegram/vk/email) for **communication channels**.  
Distribution uses a separate schema prefixed with `dist_` to avoid competing models.

- **DistributionChannel**: catalog row for a channel (e.g. `bookingcom`, `expedia`, `airbnb`).
- **OTAAccount**: per ASI account + distribution channel credentials/config container.
- **PropertyChannelConnection**: connects an ASI `property` to a distribution channel (and optionally an `OTAAccount`).
  - This is the **operational boundary** for isolation, disablement, and “don’t let one broken channel corrupt others”.
- **ChannelListing**: maps internal listing keys to external listing IDs for a connection.
- **RatePlan**: maps internal rate plan keys to external rate plan IDs for a connection.
- **Availability / Inventory**: stored as daily snapshots (`dist_availability_days`).
- **Rates**: stored as daily snapshots (`dist_rate_days`).
- **ChannelReservation**: ingested reservation record (`dist_channel_reservations`) keyed by external reservation ID.
- **SyncJob**: queued work request for resync (Phase 1 stores the job; workers are Phase 2).
- **SyncEvent**: the audit log (“what was sent/received, when, result/error”).
- **IdempotencyKey**: dedupe provider retries and safe replays.

### Database schema (Phase 1)

Migration: `supabase/migrations/20260421000001_distribution_runtime_phase1.sql`

Tables:
- `dist_distribution_channels`
- `dist_ota_accounts`
- `dist_property_channel_connections`
- `dist_channel_listings`
- `dist_rate_plans`
- `dist_availability_days`
- `dist_rate_days`
- `dist_channel_reservations`
- `dist_sync_jobs`
- `dist_sync_events`
- `dist_idempotency_keys`

### API (Phase 1)

All endpoints are **server-side** Next.js API routes and are scoped by the user’s `account_id`.

#### Catalog
- `GET /api/distribution/channels`
  - returns distribution channel catalog

#### Connections (property ↔ channel)
- `GET /api/distribution/connections`
  - list connections for the workspace
- `POST /api/distribution/connections`
  - create/upsert a connection by `(property_id, channel_code)`
  - optional: create/update an `OTAAccount` inline
- `PATCH /api/distribution/connections/:id`
  - operational control: `disabled` / `connected`

#### Manual resync trigger (safe; Phase 1 stores a job)
- `POST /api/distribution/connections/:id/resync`
  - creates a queued `dist_sync_jobs` row (supports `idempotency_key`)

#### Mappings
- `GET|POST /api/distribution/connections/:id/listings`
- `GET|POST /api/distribution/connections/:id/rate-plans`

#### Availability + Rates write path (foundation)
- `POST /api/distribution/connections/:id/availability`
- `POST /api/distribution/connections/:id/rates`

These endpoints:
- upsert daily snapshots
- write an outbound `dist_sync_events` audit record
- support idempotency via `idempotency_key` (optional)

#### Reservation ingest (webhooks)
- `POST /api/distribution/webhooks/:channel`

Phase 1 behavior:
- persists a `dist_sync_events` inbound audit log
- uses `dist_idempotency_keys(scope='webhook')` to dedupe provider retries
- upserts `dist_channel_reservations` by `(connection_id, external_reservation_id)`
- respects `connection.status=disabled` (audit-only, no mutation)

### Operational safety guarantees (Phase 1)

- **Isolation**: everything is scoped by `connection_id` so one channel’s failures don’t spill into others.
- **Manual disable**: `PATCH /api/distribution/connections/:id` sets `status=disabled`.
- **Auditability**: `dist_sync_events` records request/response payloads + error status.
- **Idempotency**:
  - inbound webhooks: idempotency key from headers or body hash
  - outbound writes: optional `idempotency_key` supported for safe retries

### Phase 2 (planned)

Not implemented yet in this phase:
- Provider signature verification for webhooks and per-provider adapters
- Outbound “real push” to OTAs (API clients, retries/backoff, dead-lettering)
- Background workers for `dist_sync_jobs` (locking, scheduling, concurrency controls)
- Rich internal inventory/unit model (rooms/unit types) and mapping to `internal_listing_key`
- Full restrictions model (CTA/CTD, length-of-stay, derived rules)
- Two-way reconciliation flows (diff + conflict resolution)
- Metrics dashboards + alerting for sync health

