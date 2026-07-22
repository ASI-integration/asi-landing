# Communication Contour Pilot Readiness Report

Task: `dashboard-20260722155509-b18895`  
Baseline: `25ca3904bbcf96b9290ebbb53939ebc4b346894d`  
Date: 2026-07-22

This report covers local engineering readiness only. No live Telegram, Email, STT, TTS, or webhook validation was executed in this run. Do not treat channels as live-pilot ready where real live tests were not run.

## Subtasks

| # | Area | Result |
| --- | --- | --- |
| 1 | Audit vs `docs/communication-live-test-plan.md` | Done. Voice webhook→STT path was already wired; docs were stale. |
| 2 | Telegram text | Existing: webhook, normalize, session/booking context, no-invented-facts policy, focused tests. No code change required. |
| 3 | Operator handoff | Guest escalations now go through `requestOperatorHandoff` (audit + single active review). Acknowledge uses `lockSessionForOperator`. |
| 4 | Duplicate protection | Existing inbound/outbound idempotency; added voice duplicate + empty-transcript coverage. |
| 5 | Email draft-only | Defaults remain draft-only / auto-send off. Added adapter-level suppress guard. |
| 6 | Telegram Voice/STT | Gap closed in docs; path already wired. Tests cover session continuity, STT fail, empty transcript, duplicates. |
| 7 | Voice/TTS helper | Disabled by default; text fallback covered; default-off test added; next enable step documented in `voice-reply.ts`. |
| 8 | Communication Dashboard | Honest channel foundation already present (Telegram active, Email foundation/semi-auto, Phone planned). No approved UX change. |
| 9 | Acceptance checks | Focused communication tests + typecheck + ESLint on touched files (see run notes). |
| 10 | Final report | This file. |

## Changed files

- `src/lib/communication/escalations.ts` — escalate via `requestOperatorHandoff`
- `src/app/api/operator/escalation-reviews/[reviewId]/route.ts` — acknowledge via `lockSessionForOperator`
- `src/lib/communication/channels/email.ts` — draft-only defense-in-depth on `sendMessage`
- `src/lib/communication/voice-reply.ts` — document default-off + next enable step
- `src/lib/communication/__tests__/escalations.test.ts`
- `src/lib/communication/__tests__/telegram-voice-inbound.test.ts`
- `src/lib/communication/__tests__/telegram-voice-reply-fallback.test.ts`
- `docs/communication-live-test-plan.md` — remove stale fallback-only claims; document handoff semantics
- `docs/communication-contour-pilot-readiness-report.md` — this report

## Channel readiness (engineering / not live-proven)

| Channel | Engineering status | Live status |
| --- | --- | --- |
| Telegram text | Ready for controlled test-bot pilot after owner-approved webhook/token | Not live-tested in this run |
| Operator handoff | Ready for local/staging operator API checks | Not live-tested |
| Email | Draft-only confirmed by code + tests; auto-send remains off by default | Not live-tested |
| Telegram Voice/STT | Code path wired; needs real STT credentials for live success | Not live-tested; without STT expect safe text fallback |
| Voice reply / TTS | Helper present, disabled by default | Not enabled; owner decision required |
| Phone | Planned foundation only | Not connected |

## Risks

- Operator-active sessions may still receive limited safe operational-intake / autopilot replies (intentional). Strict silence is not enforced.
- Identity/owner/onboarding escalations still call `createOrUpdateEscalationReview` directly in orchestrator (not every escalate path emits handoff_* audits).
- Live STT/TTS/Telegram/Email require secrets and external providers — red actions; stopped here.
- Email adapter returns `true` when outbound is suppressed (dry success). Callers must not treat that as SMTP delivery proof.

## Unverified live scenarios

All checklist items in `docs/communication-live-test-plan.md` sections B–E that require a real test bot, SMTP, STT, or operator UI against staging.

## Owner decisions required before further progress

1. Dedicated test-bot webhook + token usage (not production).
2. Any real outbound Telegram/Email/STT/TTS call.
3. Enabling `VOICE_REPLY_ENABLED=1` or `EMAIL_AUTO_SEND=1`.
4. Staging/production deploy, migrations, merge to `main`.
5. Commit / push / draft PR (explicitly deferred by runtime execution constraints for this attempt).
