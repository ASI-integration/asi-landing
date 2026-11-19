# Issue #676 — iCal/OTA provider ingress and worker Telegram (DRAFT)

## Scope and acceptance
Source-only adapters implement RFC 5545 VEVENT parsing (UID, RECURRENCE-ID, SEQUENCE, IANA timezone and DST), signed JSON webhook, bounded HTTPS iCal fetching, transactional ingress inbox, revision replay/stale/cancellation, conflict review, dead letters and source checkpoint. Telegram includes the official webhook secret header, bound worker/chat/task/nonce verification, durable update-id deduplication, outbox and optional sender behind a three-factor kill switch.

THIS IS NOT LIVE_CONNECTED. Incoming entries are candidates with review statuses only, not confirmed reservations. No direct OTA writes, inventory/price publishing, guest messaging, payments or real Telegram sends. No active provider calls were made. No production/shared Supabase DDL may be applied automatically.

## Persistent schemas and transaction safety
Migration: docs/ops/strigunov-provider-ingress-telegram-676-DRAFT.sql
Shadow transaction fixture: docs/ops/strigunov-provider-ingress-telegram-676-ROLLBACK-TEST.sql
The RPC serializes all events for each account and property using a transaction advisory lock, checks for overlapping active bookings or other inbox candidates, stores conflict_review and never auto-confirms either side. Stale revisions cannot overwrite newer entries. Same revision with changed hash is an error and must go to DLQ. Cursor/checkpoint advances only after a completed fully persisted import, not on DLQ failure.

Telegram transitions require a verified enabled Telegram binding and exact assigned worker, property, chat, nonce hash, permitted task type, idempotent update_id per tenant and valid task state. open -> in_progress -> resolved. No privileged user-supplied account mapping.

## Server-side configuration NAMES (never commit values)
Provider POST /api/integrations/provider-ingress-676:
ASI_SYNTHETIC_NO_SEND=YES
ASI_PROVIDER_676_ENABLED=YES
ASI_INGRESS_676_ACCOUNT_ID
ASI_INGRESS_676_PROPERTY_ID
ASI_INGRESS_676_SOURCE_ID
ASI_INGRESS_676_HMAC_SECRET (random at least 32 chars)
ASI_INGRESS_676_TIMEZONE (optional IANA TZID)

Source must send x-asi-ingress-timestamp (Unix seconds) and x-asi-ingress-signature (sha256= HMAC-SHA256(timestamp + "." + exact raw UTF8 payload)); no user-selected scope. Supports text/calendar or application/json with reservation_id, revision, status and offset-bearing check_in/check_out.

Telegram POST /api/integrations/telegram-task-676:
ASI_SYNTHETIC_NO_SEND=YES
ASI_TELEGRAM_676_ENABLED=YES
ASI_TELEGRAM_676_WEBHOOK_SECRET (from separately authorized setWebhook)
X-Telegram-Bot-Api-Secret-Token must match exactly. The receive route never sends messages. Future sender must have ALL three flags: noSend=false, ownerLiveApproved=true, liveEnabled=true, with approved bot token. This issue does not permit enabling those conditions.

## Owner gates before connecting live sources
1. Independent SQL/RLS and webhook security review, GitHub protected CI, owner-approved exact SHA for any out-of-stage change.
2. Separately approved migration to exact target with backup and rollback; never shared Supabase by default.
3. Approve exactly one provider, source identity, HTTPS host allowlist, account/property mapping and secrets server-side. No arbitrary user-supplied URLs. RRULE expansion is deliberately unsupported and rejected.
4. Telegram: obtain bot token separately, approve private worker chat bindings and setWebhook. Verify explicit no-send workflow before requesting real outbound send permission.
5. Verify the canonical acceptance/reconciliation step separately against persisted inventory; only then consider calling a provider LIVE_CONNECTED. Current inbox is read-only candidate intake, not an automatic booking confirmation.

Standards: RFC 5545 https://www.rfc-editor.org/rfc/rfc5545 ; Telegram Bot API https://core.telegram.org/bots/api

## Focused reproduction
Run both new Vitest files (provider-ingress-676.test.ts and telegram-task-gateway-676.test.ts), local TypeScript typecheck, touched ESLint.
For shadow PG 17.11: within one BEGIN/ROLLBACK transaction, run migration DDL without its outer BEGIN/COMMIT statements, followed by ROLLBACK-TEST SQL. Confirm both new tables vanish and synthetic users are absent after the rollback. Never apply migration to production or shared Supabase.
