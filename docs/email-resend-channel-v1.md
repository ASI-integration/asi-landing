# Email / Resend Channel v1

## Goal

Provide one production-capable email transport for ASI guest communication without changing the canonical communication brain.

Flow:

`email -> Resend Receiving -> verified webhook -> Receiving API -> EmailInboundPayload -> canonical communication orchestrator -> SMTP reply/draft`

## Inbound provider

Use Resend Receiving. Configure an `email.received` webhook to:

`https://asi-global.ru/api/email/resend`

The endpoint verifies the raw webhook body with the Resend/Svix signing secret before fetching the full received email from the Resend Receiving API.

Required server-only variables:

```env
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_API_BASE_URL=https://api.resend.com
RESEND_WEBHOOK_TOLERANCE_SECONDS=300
```

Never expose these values through `NEXT_PUBLIC_*` variables.

## Outbound SMTP

The existing `EmailAdapter` already sends through SMTP. With Resend, configure:

```env
EMAIL_SMTP_HOST=smtp.resend.com
EMAIL_SMTP_PORT=465
EMAIL_SMTP_USERNAME=resend
EMAIL_SMTP_PASSWORD=<same Resend API key or dedicated sending key>
EMAIL_FROM_ADDRESS=support@asi-global.ru
```

## Safe rollout

Keep guest auto-send disabled for the first live acceptance:

```env
EMAIL_DRAFT_ONLY=true
EMAIL_AUTO_SEND=false
```

This allows real inbound messages to enter ASI and create an operator review/draft without sending anything back to the guest.

Only after a controlled inbound acceptance is PASS should owner-approved live outbound be tested with:

```env
EMAIL_DRAFT_ONLY=false
EMAIL_AUTO_SEND=true
```

## Live acceptance

1. Confirm production is on the exact accepted SHA.
2. Send one email from a dedicated test address to the ASI receiving address.
3. Verify one canonical inbound event, one conversation/session, and one operator draft/review.
4. Replay the same Resend webhook and verify no duplicate guest action.
5. Enable auto-send only with owner approval.
6. Send a second controlled message and verify one threaded reply with the correct subject and no duplicate delivery.
7. Return to the desired launch mode.

## Safety

- Invalid/missing webhook signatures are rejected before provider fetch or canonical processing.
- Signed webhook timestamps are bounded by a replay window.
- Only `email.received` events enter the inbound email path.
- Full body content is retrieved server-side using the Resend API key.
- Existing email draft-only / auto-send gates remain authoritative.
- Existing communication handoff, grounding, idempotency, and operator-review rails remain unchanged.
