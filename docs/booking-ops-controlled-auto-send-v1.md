# Controlled Actual Auto-send v1

## Approved delivery path

Booking Ops delivery must go through `communication-auto-send-executor.ts`. The executor may call only the existing Communication Orchestrator channel adapters:

- Telegram: `TelegramAdapter.sendMessage()` from `src/lib/communication/channels/telegram.ts`.
- E-mail: `EmailAdapter.sendMessage()` from `src/lib/communication/channels/email.ts`.

Direct calls to Telegram HTTP endpoints, SMTP helpers, or new provider clients are not approved for Booking Ops auto-send. Web and SMS are represented in the delivery model but are fail-closed until an approved adapter exists.

## Safety model

- Global policy can classify a supported type as queue-eligible, but `actual_send_enabled` is false globally.
- Actual delivery requires an explicit owner, property, or booking policy with `actual_send_enabled=true`.
- Policy and payload safety are checked again immediately before every attempt.
- One delivery is identified by a unique idempotency key derived from the intent version and message.
- Dry-run records the decision and attempt without calling a provider.
- Only safe summaries and provider-neutral error codes are stored; recipient secrets and message bodies are not copied into delivery metadata or logs.
- Review-required, blocked, unknown, access, document, payment, refund, complaint, conflict, and low-confidence messages remain manual.

No cron is enabled in v1. Batch execution is protected and admin-triggered only.
