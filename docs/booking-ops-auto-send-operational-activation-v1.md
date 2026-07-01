# Operational Activation v1

Global actual auto-send remains permanently off. The scheduled runner may send only when an explicit `booking`, `property`, `owner`, or `pilot` scope is enabled and the existing policy re-check returns `allowed`.

## Scheduler

`.github/workflows/booking-ops-auto-send.yml` runs every 10 minutes and calls:

`POST /api/internal/booking-ops/communications/auto-send/run`

The endpoint and GitHub Actions workflow must share `BOOKING_OPS_AUTO_SEND_RUNNER_SECRET`. `CRON_SECRET` is accepted by the endpoint as an existing-runtime fallback. Missing or invalid authorization returns `401`; neither secret is logged.

## Pilot activation

Use the compact panel on `/dashboard/booking-ops`, or call the protected scope API as an Ops administrator. Do not invent an owner or property ID. Until a real pilot ID is known, use a clearly named pilot/demo scope with `dryRunOnly=true`.

Example request body:

```json
{
  "scopeType": "pilot",
  "scopeRef": "demo-safe-dry-run",
  "dryRunOnly": true,
  "maxBatchSize": 10,
  "allowedChannels": ["telegram", "email"],
  "allowedMessageTypes": ["request_arrival_time"],
  "reason": "Проверка пилотного контура без реальной отправки."
}
```

Disable the same scope through `/scope/disable`. The emergency-stop endpoint always overrides every narrow scope. Scope controls never enable the global policy row.

The runner re-checks message type, payload safety, recipient role, quiet hours, rate limits, unresolved guest fallback/complaint state, channel allowlist, scope allowlist, batch limit, and delivery idempotency immediately before a provider call. A `dryRunOnly` scope records a dry run and never calls a provider.
