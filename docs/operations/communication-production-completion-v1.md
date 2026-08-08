# Communication Production Completion v1

Goal: close the production communication contour without weakening safety gates.

This increment does **not** add phone/telephony. It completes the existing Telegram text + Telegram voice path:

- Telegram inbound text
- Telegram inbound voice/audio -> STT -> Communication Orchestrator
- LLM Safe Domain Layer for safe-domain replies
- property-level communication autopilot / operator escalation
- Telegram text delivery
- policy-driven TTS -> Telegram `sendVoice`
- text fallback when voice delivery fails

## Existing safety model preserved

Activation does not force every property into autopilot. Property-level `communication_autopilot` remains authoritative.

The activation workflow only clears global kill-switches needed for an already-enabled property and turns on the existing LLM/voice gates:

- `LLM_SAFE_DOMAIN_ENABLED=1`
- `VOICE_REPLY_ENABLED=1`
- `VOICE_TRANSCRIPTION_DISABLED=0`
- `DRY_RUN_TELEGRAM_OUTBOUND=0`
- `TELEGRAM_DRY_RUN=0`
- `COMMUNICATION_KILL_SWITCH=0`
- `COMMUNICATION_AUTOPILOT_FORCE_DISABLED=0`

It intentionally does **not** set `COMMUNICATION_AUTOPILOT_FORCE_ENABLED=1`.

## Workflow

GitHub Actions: **Communication Production Completion v1**

### Phase A — readiness (read-only)

Mode: `readiness`

Confirmation:

`CHECK_COMMUNICATION_PRODUCTION_COMPLETION_V1`

Checks, without printing secrets:

- production health/version
- Telegram bot token and `getMe`
- LLM provider/key presence and activation state
- STT availability
- TTS provider/key presence
- ffmpeg availability for Telegram-compatible audio conversion
- voice budget state-dir configuration
- communication kill-switch / Telegram dry-run state

### Phase B — activate

Mode: `activate`

Confirmation:

`ACTIVATE_COMMUNICATION_PRODUCTION_COMPLETION_V1`

The workflow first requires all activation prerequisites. It then makes a timestamped backup of `/var/www/asi/shared/.env.production.live`, applies only the documented communication flags, reloads the environment into PM2, restarts `asi-landing`, and requires health + active readiness to pass.

No secret value is printed.

### Phase C — production acceptance

Mode: `acceptance`

Confirmation:

`ACCEPT_COMMUNICATION_PRODUCTION_COMPLETION_V1`

Use a **dedicated Telegram test chat**. Do not point synthetic acceptance at the protected owner chat.

Acceptance requires:

1. active production readiness;
2. existing Telegram autopilot production acceptance (property answers + escalation evidence);
3. real TTS generation and real Telegram `sendVoice` delivery to the test chat;
4. real STT transcription of a recent Telegram voice file.

For STT, send a fresh voice note to the test bot before running Phase C. The workflow can discover the latest voice `file_id` from PM2 logs, or the operator can paste an explicit `stt_file_id` input.

## What PASS means

A full Phase C PASS proves:

- production text/autopilot path is responding;
- operator handoff path still works for sensitive cases;
- Telegram bot connectivity works;
- production TTS credentials work;
- Telegram can deliver an actual voice bubble;
- a real Telegram voice file can be downloaded and transcribed by production STT;
- production remains healthy after activation.

It does not prove phone calls, WhatsApp voice, or external telephony. Those remain separate provider-dependent work.
