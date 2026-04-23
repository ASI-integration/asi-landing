# Telegram bot source of truth (production vs helpers)

## Production: what determines the active bot

- **Active production Telegram bot identity**: determined only by the runtime environment variable `TELEGRAM_BOT_TOKEN`.
  - Deploy/runtime config (e.g. Vercel env vars) is the source of truth.
  - Local `.env*` files and helper scripts **do not** change the production bot unless their values are copied into the deployment runtime environment.

## Production: what determines the webhook route

- **Production webhook entrypoint**: `POST /api/telegram/webhook`
  - Implemented at `src/app/api/telegram/webhook/route.ts`.

## Production: what determines bot behavior

Behavior is driven by the runtime request handler and the communication pipeline:

- `src/app/api/telegram/webhook/route.ts` (webhook receipt + routing)
  - calls `src/lib/communication/orchestrator.ts` (core update processing)
    - uses `src/lib/communication/classifier.ts` (classification/decision inputs)

## Current scope note (practical)

- **Telegram is text-first in production.**
- **Telegram voice is intentionally de-scoped for now.** Voice notes get the honest fallback: “Не удалось распознать голосовое. Пришлите, пожалуйста, текстом.”
- **Next voice priority is phone/telephony** (not implemented yet in this repo; placeholder lives under `src/lib/communication/voice/`).

## Local/helper-only vs production sources

The following files/scripts exist for local operations, debugging, and admin convenience. They are **not** production sources of truth by themselves.

### Env files

- **`.env.example`**: local template (**local helper**) — example keys only.
- **`.env.ru`**: local workstation helper (**local helper / potentially confusing**) — used by RU helper scripts to hold `ADMIN_SECRET` and/or a token for inspection; not a production source of truth.
- **`.env.ru.production.pulled`**: pulled snapshot for local debugging (**smoke/debug only / potentially confusing**) — an exported set of production values for local smoke tests; does not affect production unless re-applied to runtime env.

### Helper scripts

- **`scripts/tg-webhook-info.mjs`**: calls Telegram API (`getMe`, `getWebhookInfo`) using token from `.env.ru` (**local helper / debug**).
- **`scripts/check-ru-telegram-webhook.mjs`**: calls production admin route `/api/admin/telegram-webhook-info` using `ADMIN_SECRET` from `.env.ru` (**local helper / debug**).
- **`scripts/set-ru-telegram-webhook.mjs`**: calls production admin route `/api/admin/telegram-webhook-set` using `ADMIN_SECRET` from `.env.ru` (**local helper / admin**).
- **`scripts/ru-telegram-send-smoke.mjs`**: sends a test message using token/chat from `.env.ru.production.pulled` (**smoke/debug only**).

## Practical checklist (avoid confusion)

- If you want to know **which bot production is using**: inspect the **deployment runtime** `TELEGRAM_BOT_TOKEN`.
- If you want to know **where production receives webhooks**: it is always `POST /api/telegram/webhook`.
- If you want to change **bot behavior**: change the pipeline (`route.ts` → `orchestrator.ts` → `classifier.ts`), not helper scripts.
