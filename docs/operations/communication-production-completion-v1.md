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

Safety acknowledgement: select `authorized_for_selected_mode` after obtaining the separate owner approval required for a production workflow run. The constrained choice replaces the error-prone exact-string input; it is a technical guard, not owner approval by itself.

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

Safety acknowledgement: `authorized_for_selected_mode`.

The workflow first requires all activation prerequisites. It then makes a timestamped backup of `/var/www/asi/shared/.env.production.live`, applies only the documented communication flags, reloads the environment into PM2, restarts `asi-landing`, and requires health + active readiness to pass.

No secret value is printed.

### Phase C — production acceptance

Mode: `acceptance`

Safety acknowledgement: `authorized_for_selected_mode`.

Use a **dedicated Telegram test chat**. Do not point synthetic acceptance at the protected owner chat.

Acceptance requires:

1. active production readiness;
2. existing Telegram autopilot production acceptance (property answers + escalation evidence);
3. real TTS generation and real Telegram `sendVoice` delivery to the test chat;
4. real STT transcription of a recent Telegram voice file.

Each acceptance command is reported as a named stage. The workflow fails closed and prints the exact failed stage (`active_state`, `text_autopilot`, `outbound_tts_and_send_voice`, `inbound_stt_input`, or `inbound_stt`) instead of allowing a partial run to look green.

## TTS provider and credential behavior

`VOICE_TTS_PROVIDER` remains the preferred direct provider; `VOICE_TTS_BASE_URL` still takes precedence for the existing relay. If that provider fails, the voice path tries an already-configured secondary provider. In the current supported direct setup this means ElevenLabs can fall back to OpenAI when `OPENAI_API_KEY` or `VOICE_TTS_API_KEY` is present, and OpenAI can fall back to ElevenLabs when `ELEVENLABS_API_KEY` is present. `VOICE_TTS_FALLBACK_PROVIDER` can explicitly select an already-configured secondary provider.

Provider-specific settings prevent an ElevenLabs model or voice id from being sent to OpenAI during fallback:

- ElevenLabs: `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_VOICE_ID`;
- OpenAI: `OPENAI_API_KEY` or `VOICE_TTS_API_KEY`, with optional `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, and `OPENAI_TTS_RESPONSE_FORMAT`.

An ElevenLabs HTTP 401 is reported as `invalid_credential` with `credentialReplacementRequired=true` and `credentialEnv=ELEVENLABS_API_KEY`. No credential value or provider response body is printed. The operator must replace the production `ELEVENLABS_API_KEY`; code cannot repair an invalid or revoked credential. If OpenAI fallback succeeds, the acceptance records the fallback and emits a warning while still proving real TTS and Telegram `sendVoice` delivery.

If every configured provider fails, voice delivery returns false and the existing Telegram adapter still sends the normal text answer. Logs contain only provider name, status/classification, safe provider code, and the secret variable name when replacement is required.

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
