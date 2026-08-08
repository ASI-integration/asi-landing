# Communication Readiness And Live Test Plan

Controlled checks for Communication readiness, Telegram, Email, Phone-ready foundation, and operator handoff.

This plan is intentionally test-only. Do not run it against production guest chats, payment flows, report intake, location scoring, deployment scripts, or Operations pages.

## Manual Smoke Checklist: Dashboard MVP Readiness

Open `/dashboard/communication` in a local or staging environment with test data only.

- Header says that Telegram is the current main channel, Email is the base contour, and Phone is the next stage.
- Telegram card is marked as the main active channel and mentions guest messages, session/role context, object/booking context, urgent access, and operator handoff.
- Email card is marked as foundation / semi-auto and does not claim full autopilot.
- Phone card is marked as planned with `Телефон`, `Голосовые звонки`, and `Следующий этап: подключение телефонии`.
- Phone does not claim that live telephony is connected.
- A Telegram test dialog shows channel, guest, session, booking/object if known, urgency, reason for operator handoff, latest message, operator actions, and dialog history.
- An Email test dialog shows guest request, object/booking context if known, and manual or semi-auto handling.
- A Phone test item, if present from synthetic data, is treated as planned intake: call text to task/operator escalation, urgent access scenario, and no claim of active external phone integration.

## Channel Readiness Checklist

### Telegram

- Channel type: `telegram`.
- Dashboard state: active main channel.
- Provider state: Telegram adapter/webhook path can be tested with a dedicated test bot.
- Must still show correctly in filters, readiness cards, and dialog details.

### Email

- Channel type: `email`.
- Dashboard state: foundation / semi-auto.
- Provider state: email adapter is present, but UI must not promise full autopilot.
- Must still show correctly in filters, readiness cards, and dialog details.

### Phone-ready

- Channel type: `phone`.
- Dashboard state: planned / coming soon.
- Provider state: placeholder only; no real telephony provider is connected.
- Required RU copy: `Телефон`, `Голосовые звонки`, `Следующий этап: подключение телефонии`.
- Synthetic phone items may be used to verify transcript-to-task/operator handling, but the UI must not promise live calling.

## Current Implementation Notes

- Telegram text messages enter `src/app/api/telegram/webhook/route.ts` and then `processUpdate`.
- Long-poll ingress for dedicated test bots uses `src/lib/communication/telegram-poller.ts`
  (`getUpdates` with `allowed_updates` including `callback_query`) and the same `processUpdate` router.
- Email and Phone are represented as first-class communication channel types for shared handling.
- Phone is phone-ready only: `src/lib/communication/channels/phone.ts` and `src/app/api/phone/webhook/route.ts` provide a generic foundation, but no real telephony provider is wired.
- Telegram `voice` and `audio` webhook messages route through `processTelegramVoiceUpdate` in `src/lib/communication/telegram-voice-inbound.ts`: download → STT → Communication `processMessage` on the same Telegram chat session.
- Empty or whitespace-only transcripts and STT failures send a safe RU text fallback and do **not** create a conversation session.
- Duplicate voice updates are dropped by inbound idempotency (`tg_voice:{updateId}:{messageId}:{fileId}`).
- `src/lib/communication/voice-transcription.ts` and `src/lib/communication/voice/stt.ts` provide Telegram file download and STT plumbing used by that inbound path. Live STT still needs real provider credentials; local tests must mock them.
- `src/app/api/dev/voice/simulate/route.ts` can test transcript-to-Communication behavior without real Telegram audio.
- Outbound Telegram voice reply helper exists in `src/lib/communication/voice-reply.ts` and is optionally invoked from `TelegramAdapter` only when `VOICE_REPLY_ENABLED=1` and policy allows voice. It is disabled by default; text reply always remains mandatory.
- The current TTS enable flag in code is `VOICE_REPLY_ENABLED=1`; `TELEGRAM_VOICE_REPLY_ENABLED` is not read by current code unless a later branch adds that alias.
- Operator handoff: guest escalations go through `requestOperatorHandoff` (via `recordCommunicationEscalation`) so duplicate escalations reuse one active review and emit `handoff_requested` / `handoff_request_idempotent`. Acknowledge uses `lockSessionForOperator` (`handoff_locked`). While a lock is active, normal LLM automation is blocked (`ai_reply_blocked`), but safe operational-intake / limited autopilot replies may still run for context collection — this is intentional, not a full silence mode.

## A. Pre-Flight Checks

Use a dedicated Telegram test bot and a dedicated test chat. Never use the production bot or a real guest chat.

Required for Telegram text webhook tests:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...          # optional, but recommended
COMM_PIPELINE_DEBUG=1
TELEGRAM_DEBUG=1
COMM_STATE_DIR=.asi-comm-state-dev   # keeps handoff review state local and disposable
```

Required for LLM-backed replies, if testing LLM paths:

```bash
LLM_API_KEY=...                      # or OPENAI_API_KEY
LLM_BASE_URL=...                     # optional
```

Required for durable session/status persistence, if testing beyond in-memory behavior:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Required for Telegram voice STT once webhook routing is wired:

```bash
TELEGRAM_BOT_TOKEN=...
VOICE_STT_PRIMARY=llm_primary        # or openai, llm_fallback
VOICE_STT_FALLBACK=llm_fallback      # optional
VOICE_STT_MODEL=...                  # optional
VOICE_STT_TIMEOUT_MS=30000           # optional
TELEGRAM_FILE_TIMEOUT_MS=20000       # optional
TELEGRAM_VOICE_MAX_BYTES=20971520    # optional
VOICE_TRANSCRIPTION_DISABLED=0
```

Required for Telegram voice replies, helper-level only until wired:

```bash
VOICE_REPLY_ENABLED=1
VOICE_TTS_PROVIDER=elevenlabs          # preferred provider; openai is also supported
VOICE_TTS_FALLBACK_PROVIDER=openai     # optional; only used when already configured
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...              # optional
ELEVENLABS_MODEL_ID=...              # optional
OPENAI_API_KEY=...                   # existing OpenAI TTS fallback
OPENAI_TTS_MODEL=gpt-4o-mini-tts     # optional fallback-specific override
OPENAI_TTS_VOICE=coral               # optional fallback-specific override
ELEVENLABS_TIMEOUT_MS=20000          # optional
VOICE_REPLY_MAX_CHARS=300            # optional
TELEGRAM_BOT_TOKEN=...
```

Start local server:

```bash
npm run dev
```

Expose local webhook only for a dedicated test bot:

```bash
ngrok http 3000
```

Set Telegram webhook manually for the test bot:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url":"https://<ngrok-host>/api/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message","edited_message","callback_query"]}'
```

Safety setup:

- Set webhook only on the test bot token.
- Keep `TELEGRAM_DRY_RUN=1` if validating routing without outbound sends.
- Keep `VOICE_REPLY_ENABLED` unset unless explicitly testing voice reply helper behavior.
- Clear local handoff state before a run by deleting `.asi-comm-state-dev` if no useful state must be preserved.
- Do not run `scripts/set-ru-telegram-webhook.mjs` for local tests; it targets the hosted RU domain.

## B. Text Message Scenarios

Autopilot MVP helper checks:

- `заселение`, `как попасть`, `адрес`, `инструкция`, `Wi-Fi`, `выезд`, `ранний заезд`, and `поздний выезд` return `auto_reply` only when the needed booking/object context is present.
- Missing booking/object fields return `needs_context`; the helper must not invent address, access code, Wi-Fi, or checkout time.
- Access failures such as `код не работает`, `замок не открывается`, or `не могу попасть` return `escalate` with explicit reason `urgent_access_problem`.
- Phone remains planned-only: use helper metadata for audit checks, but do not treat it as connected telephony.

1. Simple guest question
   - Send: `Hi, what is the Wi-Fi password?`
   - Expect: one text reply, no operator review.
   - Logs: `[tg:webhook] recv`, `[comm:routing] path=telegram_text`, `processMessage.return.success`.

2. Booking-related question
   - Send: `Can I check in at 15:00 tomorrow?`
   - Expect: reply or clarifying question, session memory updated.
   - Check: no duplicate outbound on resend of the same Telegram update.

3. Complaint or escalation
   - Send: `I am very upset, the lock is broken and nobody is helping.`
   - Expect: escalation wording and an operator review item.
   - Logs: `operator_review_audit.review_created`, `handoff=handoff_requested`, session status `operator_review_required`.

4. Operator lock blocks AI reply
   - Acknowledge the review through the operator API/UI.
   - Send another guest text message.
   - Expect: AI does not produce normal automation; reply should be blocked or acknowledge human handling.
   - Logs: `handoff=ai_reply_blocked`.

5. Release back to AI
   - Close/release the review through operator API/UI, or use guarded `/reset_session` only in acceptance testing.
   - Send: `Thanks, can you confirm checkout time?`
   - Expect: AI replies again.
   - Logs: lock state becomes `returned_to_ai` or session reset trace appears.

## C. Telegram Voice Inbound Scenarios

Run these against the wired webhook → download → STT → Communication path. Live STT still requires real provider credentials; without them the expected result is the safe text fallback.

1. Voice message transcribes
   - Send a short Telegram voice note: `What is the Wi-Fi password?`
   - Expect with working STT: Telegram downloads file, STT succeeds, transcript enters Communication, bot replies with text.
   - Expected logs: `[tg:voice] inbound`, `[tg:voice] getFile.ok`, `[tg:voice] download.ok`, `[voice:stt] attempt.ok`, `[tg:voice] brain.done`.
   - Without STT credentials / when transcription is disabled: `telegram_voice_fallback` and fallback reply.

2. Transcript enters same session
   - Send text: `I am arriving tomorrow.`
   - Send voice: `Can I check in early?`
   - Expect with working STT: one Communication session for same Telegram chat, transcript appears as inbound voice/audio source metadata.

3. Failed STT fallback
   - Temporarily set `VOICE_TRANSCRIPTION_DISABLED=1` or break STT config in the test environment.
   - Send voice note.
   - Expect: clear fallback text, webhook returns 200, no broken session created from empty transcript.

4. Voice after text keeps context
   - Send text with context: `I am at Nevsky 24.`
   - Send voice: `The door code does not work.`
   - Expect with working STT: reply/escalation uses same chat/session context.

5. Text after voice keeps context
   - Send voice: `The shower is leaking.`
   - Send text: `Apartment 12.`
   - Expect with working STT: text is appended to the same session and may complete missing facts.

## D. Telegram Voice Outbound Scenarios

Voice replies are disabled by default (`VOICE_REPLY_ENABLED` unset). The helper is available from `TelegramAdapter` only when explicitly enabled; do not enable on production guest traffic without owner approval.

1. Voice reply disabled by default
   - Ensure `VOICE_REPLY_ENABLED` is unset.
   - Trigger any reply.
   - Expect: text only, no `sendVoice` call.

2. Enable voice reply helper
   - Set `VOICE_REPLY_ENABLED=1` with ElevenLabs and Telegram env vars.
   - If a later branch adds `TELEGRAM_VOICE_REPLY_ENABLED`, confirm whether it aliases to `VOICE_REPLY_ENABLED`.
   - Exercise `sendVoiceReply` in an isolated helper/dev harness before enabling on a live test bot.

3. TTS success sends voice
   - Use a short, non-payment, non-escalation reply under `VOICE_REPLY_MAX_CHARS`.
   - Expect: `tts.ok`, `telegram.sendVoice.ok`, then no duplicate voice send on retry. If the preferred provider fails and a secondary provider is configured, expect `fallback_used=true` and a sanitized provider attempt list.

4. TTS failure falls back to text
   - Make all configured TTS providers unavailable or force timeouts.
   - Expect: `voice_reply.fail_tts` with sanitized reasons and the normal text reply remains available.

## E. Handoff Scenarios

1. Escalation creates handoff lock
   - Trigger low-confidence, urgent, or complaint path.
   - Expect: one active escalation review and lock state `operator_requested`.

2. Duplicate escalation does not duplicate lock
   - Re-send the same triggering message or repeat the same escalation in the same session.
   - Expect: same active review reused, `handoff_request_idempotent`, no duplicate operator lock.

3. Operator active blocks AI
   - Acknowledge or approve review.
   - Send another guest message.
   - Expect: AI normal reply blocked while lock state is `operator_active`.

4. Resolved or returned_to_ai permits AI again
   - Close/release review.
   - Send a normal guest question.
   - Expect: AI replies and lock state reads `returned_to_ai`.

Operator API endpoints require an authenticated operator session:

```text
GET   /api/operator/escalation-reviews?status=pending
GET   /api/operator/escalation-reviews/:reviewId
PATCH /api/operator/escalation-reviews/:reviewId
```

Patch actions:

```json
{ "action": "acknowledge" }
{ "action": "approve" }
{ "action": "send_reply", "replyText": "Manual operator reply" }
{ "action": "close" }
```

## F. Acceptance Criteria

Expected logs and events:

- Telegram webhook receipt: `[tg:webhook] recv`
- Text routing: `[comm:routing] path=telegram_text`
- Voice routing: `[tg:voice] inbound`, STT attempt logs, brain completion logs when STT succeeds; otherwise `telegram_voice_fallback`
- Handoff: `operator_review_audit`, `handoff=handoff_requested` / `handoff_request_idempotent`, `handoff=handoff_locked`, `handoff=ai_reply_blocked`, `handoff=handoff_released`
- Duplicate prevention: `DuplicateDropped`, `DuplicatePreventedOutbound`, or operator duplicate-prevented audit event

Expected bot behavior:

- One inbound message produces at most one guest-visible bot response.
- Duplicate Telegram deliveries do not send duplicate replies.
- Escalated/operator-active sessions do not receive normal AI automation.
- Released sessions can receive AI replies again.
- Failed STT and failed TTS never crash the webhook and never block text fallback.

## G. Rollback And Safety

To disable voice replies:

```bash
unset VOICE_REPLY_ENABLED
# or in PowerShell:
Remove-Item Env:VOICE_REPLY_ENABLED
```

To revert to text-only:

```bash
VOICE_TRANSCRIPTION_DISABLED=1
VOICE_REPLY_ENABLED=
```

Also remove the test webhook from the test bot when finished:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
```

Do not test on production:

- Do not use production guest chats.
- Do not use the production bot token.
- Do not set the hosted production webhook to a local/ngrok URL.
- Do not test payment/refund scenarios with real payment links.
- Do not use real guest personal data in voice notes or transcripts.

## Local Verification Commands

Run before and after live testing:

```bash
npx vitest run src/lib/communication/__tests__/channels.test.ts src/lib/communication/__tests__/phone-support.test.ts
npm run typecheck
```
