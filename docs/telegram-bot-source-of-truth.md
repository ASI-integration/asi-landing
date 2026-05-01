# Telegram bot source of truth (production vs helpers)

## Production: canonical decision runtime

- **Communication decisions** (policy-first replies, escalation, idempotency, approval gates, owner-notification eligibility) are owned by **`scalable-fastapi-backend`** (`app/communication/*`), exposed over HTTP as:

  - **`POST /api/communication/telegram/inbound`**

- **`asi-landing`** remains the **public webhook URL** and **transport layer** only when bridging is enabled:

  - **`POST https://asi-global.ru/api/telegram/webhook`** (same route path as before)

- When **`TELEGRAM_BACKEND_PIPELINE_URL`** is set at runtime on `asi-landing`, inbound Telegram updates are forwarded to the backend pipeline endpoint; the Next route sends customer-visible Telegram replies **only** using **`outbound_payload`** returned by the backend.

- The TypeScript orchestrator (`src/lib/communication/orchestrator.ts`) is **legacy fallback** while **`TELEGRAM_BACKEND_PIPELINE_URL`** is unset, or when the backend call fails (network / non-200 / invalid decision). Do **not** duplicate Python policy rules in TypeScript for new production behavior.

## Production: what determines the active bot

- **Active production Telegram bot identity**: determined only by the runtime environment variable **`TELEGRAM_BOT_TOKEN`**.
  - Deploy/runtime config (e.g. Vercel env vars) is the source of truth.
  - Local `.env*` files and helper scripts **do not** change the production bot unless their values are copied into the deployment runtime environment.

## Production: webhook URL (unchanged)

- **Production webhook entrypoint path**: **`POST /api/telegram/webhook`**
  - Implemented at `src/app/api/telegram/webhook/route.ts`.
  - The **public URL** remains on **`asi-global.ru`** (do not repoint the Telegram webhook URL to the FastAPI host for normal operation).

## Transport bridge configuration (`asi-landing`)

| Variable | Purpose |
|----------|---------|
| **`TELEGRAM_BACKEND_PIPELINE_URL`** | Full URL to **`POST /api/communication/telegram/inbound`** on `scalable-fastapi-backend`. When set, the webhook uses the backend decision instead of local orchestrator logic. |
| **`TELEGRAM_BACKEND_PIPELINE_SECRET`** (optional) | Sent as **`X-Comm-Pipeline-Secret`**; must match backend **`COMM_PIPELINE_API_SECRET`** when that is configured. |
| **`TELEGRAM_BACKEND_PIPELINE_TIMEOUT_MS`** (optional) | Fetch timeout for the backend call (default 25000). |

## Backend HTTP service (`scalable-fastapi-backend`)

| Variable | Purpose |
|----------|---------|
| **`COMM_SQLITE_PATH`** | SQLite path for pipeline state/idempotency (default `comm.sqlite`). |
| **`COMM_PIPELINE_API_SECRET`** (optional) | When set, requests must include **`X-Comm-Pipeline-Secret`**. |

Run (example): `uvicorn app.http.main:app --host 0.0.0.0 --port 8080`

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
- If you want to know **where production receives webhooks**: it is always **`POST /api/telegram/webhook`** on **`asi-global.ru`**.
- If you want to know **where decisions come from** when the bridge is on: **`scalable-fastapi-backend`** pipeline (`POST /api/communication/telegram/inbound`).
- If you want to change **policy / escalation behavior**: change backend communication modules and tests — **not** duplicate rules in `asi-landing`.
