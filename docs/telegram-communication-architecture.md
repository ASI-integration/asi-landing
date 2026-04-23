# Telegram Communication Architecture

## What changed (Milestone 1 — Operational Hardening)

The original implementation put all logic — classification, LLM orchestration,
prompt building, and reply sending — inside a single 191-line route handler.
This milestone refactored it into a layered module and added webhook security,
idempotency protection, conversation persistence, a structured audit trail, and
an escalation event model.

---

## File map

```
src/app/api/telegram/webhook/route.ts   ← thin transport (secret check + body parse)

src/lib/communication/
  types.ts          domain DTOs, enums, result objects
  classifier.ts     deterministic classify() + deterministicReply() + LLM prompt helpers
  idempotency.ts    in-memory update dedup with 24-hour TTL
  audit.ts          structured JSON audit logger (console → log aggregator)
  escalation.ts     EscalationEvent model + shouldEscalate() + deriveEscalationReason()
  persistence.ts    Supabase-backed session upsert + turn insert (graceful fallback)
  orchestrator.ts   main flow: dedup → classify → LLM/fallback → persist → escalate → reply

src/lib/telegram.ts   sendTelegramMessage + replyToTelegram  (unchanged)
src/lib/openai.ts     callLLM with 8-second timeout          (unchanged)
```

---

## Flow architecture

```
POST /api/telegram/webhook
  │
  ├─ 1. Secret validation
  │     Header: X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET
  │     → 403 if mismatch (Telegram treats 4xx as final, no retry)
  │     → warn + allow if env var is unset (backward-compatible dev mode)
  │
  ├─ 2. Body parse → TelegramUpdate
  │
  ├─ (Voice/audio) → **telegram_voice_fallback** (text-only scope)
  │     Reply: “Не удалось распознать голосовое. Пришлите, пожалуйста, текстом.”
  │
  └─ (Text/caption/attachments) → **telegram_text** → orchestrator.processUpdate(update)
       │
       ├─ 2a. Idempotency check (checkAndMark)
       │       Duplicate? → audit DUPLICATE_DROPPED → return {outcome:duplicate}
       │
       ├─ 2b. classify(text, lang_code)
       │       deterministic keyword classifier → {category, lang, slots}
       │
       ├─ 2c. audit INBOUND_RECEIVED
       │
       ├─ 2d. Build reply
       │       LLM-eligible category (guest-message, issue, booking, fallback)?
       │         → callLLM(systemPrompt, buildUserPrompt)
       │         → success: use LLM reply   → audit LLM_CALLED
       │         → null:    deterministicReply → audit LLM_FALLBACK
       │       Other category (start, greeting)?
       │         → deterministicReply (no LLM call)
       │
       ├─ 2e. Persist (fire-and-forget, errors logged but don't abort)
       │       upsertSession(chat_id)
       │       saveUserTurn(chat_id, update_id, text, category, lang)
       │
       ├─ 2f. Escalation check
       │       shouldEscalate(classification, llmSucceeded)?
       │         → createEscalationEvent(...)
       │         → audit ESCALATION_CREATED
       │
       ├─ 2g. replyToTelegram(chat_id, replyText)
       │
       ├─ 2h. audit OUTBOUND_SENT
       │
       ├─ 2i. saveAssistantTurn(...)
       │
       └─ return ProcessResult {outcome, chat_id, category, escalation?}

Always return HTTP 200 (prevents Telegram retry storms on logic errors)
```

---

## Webhook secret setup

1. Generate a secret (≥ 32 random chars):
   ```
   openssl rand -hex 32
   ```
2. Add to your environment:
   ```
   TELEGRAM_WEBHOOK_SECRET=<value>
   ```
3. Register with Telegram (one-time):
   ```
   POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
   {
     "url": "https://yourdomain/api/telegram/webhook",
     "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
   }
   ```
   Telegram will send `X-Telegram-Bot-Api-Secret-Token: <value>` on every delivery.
   Requests missing or failing this header are rejected with HTTP 403.

---

## Idempotency

- Store: process-local `Map<update_id, {processedAt: timestamp}>`
- TTL: 24 hours (entries swept lazily on each call)
- Duplicate update: audit event logged, no reply sent, no DB write
- **Limitation**: resets on cold start / server restart. A Telegram retry
  arriving just after a restart could be processed twice. Acceptable for
  current scale; swap the backing store to Redis or a Supabase dedup table
  when needed.

---

## Conversation persistence

Supabase tables required (create via Supabase SQL editor or migration):

```sql
-- Session: one row per Telegram chat, updated on every message
create table tg_conversation_sessions (
  chat_id     bigint primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  guest_id    text,         -- reserved: matched guest ID
  property_id text          -- reserved: matched property ID
);

-- Turns: every inbound + outbound message
create table tg_message_turns (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null references tg_conversation_sessions(chat_id),
  update_id   bigint,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,           -- truncated at 2000 chars
  category    text,
  lang        text,
  created_at  timestamptz not null default now()
);

create index on tg_message_turns (chat_id, created_at);
```

Graceful degradation: if tables don't exist or Supabase is unavailable,
`PERSIST_ERROR` audit events are emitted but the message is still processed
and replied to.

---

## Audit trail

All audit events are written as single-line JSON to stdout:

```json
{"audit":{"type":"INBOUND_RECEIVED","chat_id":123,"update_id":456,"message_preview":"check-in at 3pm…","category":"booking","lang":"en","ts":"2026-01-01T12:00:00.000Z"}}
```

Event types:

| Type | When |
|---|---|
| `INBOUND_RECEIVED` | Message received and classified |
| `OUTBOUND_SENT` | Reply sent to Telegram |
| `DUPLICATE_DROPPED` | update_id already processed |
| `LLM_CALLED` | LLM returned a reply |
| `LLM_FALLBACK` | LLM returned null, deterministic reply used |
| `ESCALATION_CREATED` | shouldEscalate() returned true |
| `PERSIST_ERROR` | DB write failed (non-fatal) |
| `UNHANDLED_ERROR` | Unexpected exception in orchestrator |

Rules: no raw message bodies beyond 100-char preview, no tokens or API keys.

---

## Escalation event model

`EscalationEvent` is created when:
- Category is `issue` AND both `isUrgent` AND `isAccessRelated` slots are true (even if LLM succeeded)
- LLM returned null on any substantive category (guest-message, issue, booking, fallback)

Escalation reasons: `URGENT_ISSUE`, `LLM_UNCERTAIN`, `REQUIRES_OPERATOR`, `PROCESSING_ERROR`

Current behaviour: event is created, attached to `ProcessResult`, and logged
via audit. No tickets are created, no operator notifications are sent.
The interface is designed for easy forwarding to a queue or webhook.

---

## Current limitations

| Area | Limitation |
|---|---|
| Idempotency | In-memory; resets on restart |
| Conversation history | Single-turn LLM calls; no history sent to LLM |
| Escalation delivery | Logged only — not forwarded to operator |
| Guest identity | No mapping from chat_id to guest/booking record |
| Multi-tenancy | Single bot token; no per-property routing |
| LLM provider | Hardwired to OpenAI `gpt-4o-mini` |

---

## Next 3 recommended steps

**Step 1 — Persistent idempotency**
Replace the in-memory Map in `idempotency.ts` with a Supabase `tg_processed_updates`
table (or Redis). Add a unique constraint on `update_id`. The interface already
supports this swap without changing any callers.

**Step 2 — Escalation delivery**
Add a `dispatchEscalation(event: EscalationEvent)` function in `escalation.ts`
that POSTs to a configured webhook URL (`ESCALATION_WEBHOOK_URL` env var) or
inserts into a Supabase `tg_escalations` table. The orchestrator already creates
and surfaces the event — delivery is the only missing piece.

**Step 3 — Conversation history in LLM calls**
Load the last N turns from `tg_message_turns` (via `loadSession` + a
`getRecentTurns(chat_id, limit)` query in `persistence.ts`) and prepend them to
the `callLLM` messages array. This makes the assistant context-aware without
requiring external memory infrastructure.
