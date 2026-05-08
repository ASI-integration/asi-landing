# Telegram Canon Compliance

## Canon markdown currently used

- `docs/CANONICAL-AI-GUIDED-SETUP-AND-DASHBOARD.md` — truthfulness, Master Card/object context, booking/placement contour, and guided communication doctrine.
- `docs/telegram-bot-source-of-truth.md` — production Telegram webhook and behavior source of truth.
- `docs/telegram-communication-architecture.md` — text pipeline, escalation, persistence, idempotency, and handoff boundaries.
- `docs/communication-live-test-plan.md` — manual acceptance behavior for Telegram text, slow/duplicate replies, and operator handoff.
- `docs/blueprints/ASI-OPS-CONTOUR-BLUEPRINT.md` — OPS autonomy boundaries: silent by default, human review for disputes, safety, and financial/liability cases.
- `docs/platform-90-percent-roadmap.md` — Communication/Ops integration target, especially reservation ambiguity and avoiding duplicated policies.

No `docs/canon`, `docs/core`, `docs/domain`, or `docs/working` canon directory existed before this note; current communication canon is in the root docs above plus the OPS blueprint.

## Code consuming canonical rules

- `src/lib/communication/telegram-communication-canon.ts` is the thin canonical adapter. It exposes source docs, rule groups, operational scenario rules, required context, prohibited claims, check-in time bands, Russian check-in wording, and multi-intent scenario lines.
- `src/lib/communication/telegram-operational-policy-executor.ts` uses the adapter for rule lookup, canonical actions, and check-in time scenario mapping.
- `src/lib/communication/telegram-operational-intake.ts` uses the adapter for check-in buckets and Russian check-in policy replies.
- `src/lib/communication/telegram-reply-composer.ts` uses the adapter for check-in copy and multi-intent Russian policy lines.
- `src/lib/communication/telegram-dry-run.ts` reports slow/final reply flags from canonical policy actions.
- `src/lib/communication/orchestrator.ts` consumes the policy executor and reply composer, so Telegram operational replies flow through the adapter-backed path.
- `src/lib/communication/telegram-operational-knowledge.ts` remains as a compatibility re-export only.

## Still intentionally template-based

- Property templates from `src/lib/communication/templates.ts` remain for verified pre-check-in, checkout, follow-up, and escalation contact text.
- Grounded property knowledge snippets remain template-shaped in `telegram-reply-composer.ts`, but they are only used after policy/matching says the object context is known and property knowledge exists.
- Telegram meta/social short replies remain deterministic in `telegram-text-meta-handler.ts`; they are not operational policy answers.
- Channel adapter formatting remains transport-specific and does not decide policy.

## Manual Telegram acceptance checklist

- Send a multi-intent RU message with check-in time, Wi-Fi, parking, late checkout, and refund/cancellation. Expect one final reply, no slow acknowledgement after it, and operator wording only for escalation topics.
- Ask for check-in at `07:00`. Expect very-early wording tied to previous-night availability, without treating same-day cleaning as certain.
- Ask for check-in at `15:00`. Expect standard check-in wording, not early-check-in constraints.
- Ask for check-in at `12:00`. Expect conditional wording, not a guarantee.
- Ask for Wi-Fi, key/access, address/entrance, or parking without object/booking context. Expect a clarification, not invented credentials or directions.
- Trigger urgent access (`не могу войти прямо сейчас`, `код не работает`). Expect escalation/operator action.
- Trigger complaint/refund/cancellation. Expect escalation or explicit policy-based handoff, not a refund/availability promise.
- Use `/api/internal/telegram-dry-run` with the internal test secret and verify `detectedIntents`, `replyText`, `actions`, `escalated`, `slowAckSent`, and `finalReplied` are returned.
