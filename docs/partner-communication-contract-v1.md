# Partner Communication Contract v1

## Status and boundary

This document freezes a partner-neutral, server-only contract for one event:
`guest.message.received` under schema `partner.communication.v1`. The same authenticated endpoint also accepts the strict recovery-event variants documented in [Partner Service Recovery Loop v1](PARTNER_SERVICE_RECOVERY_V1.md); message-only fields remain specific to `guest.message.received`.

Partner-facing `operationalActions[].actionId` is an opaque stable `pact_...` reference. It is not the internal `partner_communication_actions.id` UUID and must be used for authenticated `operation.updated` events. Recovery responses expose an independent opaque `prec_...` `recoveryRef`.

There is no real Apart Sharing integration, public partner webhook, outbound
delivery, queue, or external provider call in this version. The authenticated
server-to-server boundary uses hashed bearer credentials and server-side
tenant/property/booking mappings. Apart Sharing-like names in the synthetic
fixture are examples only.

Partner-provided identity becomes usable only after the authenticated
server-to-server boundary matches it to the credential principal. Contract
validation alone does not authenticate a partner. Public guest input is never
authoritative tenant scope and must never be passed to
`validateTrustedPartnerCommunicationEvent`.

## Partner to ASI

```json
{
  "schemaVersion": "partner.communication.v1",
  "eventId": "partner-event-1",
  "eventType": "guest.message.received",
  "occurredAt": "2026-08-15T12:00:00.000Z",
  "partner": {
    "partnerId": "partner-demo",
    "accountId": "account-1"
  },
  "property": {
    "propertyId": "property-101"
  },
  "booking": {
    "bookingId": "booking-5001",
    "status": "confirmed",
    "checkInAt": null,
    "checkOutAt": null
  },
  "guest": {
    "guestId": "guest-77",
    "preferredLanguage": "ru"
  },
  "conversation": {
    "conversationId": "conversation-900",
    "messageId": "message-1",
    "channel": "partner_messaging",
    "text": "Какой пароль от Wi-Fi?"
  }
}
```

The schema is exact and fail-closed. Unknown root or nested fields are rejected.
Booking status and dates may be absent or `null`; malformed supplied values and
`checkOutAt <= checkInAt` are rejected.

## Canonical identity

Every authoritative entity is scoped by normalized `partnerId` and
`accountId`. Canonical keys use length-prefixed values, so delimiters inside an
external identifier cannot create collisions.

Conceptually:

```text
partner:v1 | entityType | partnerId | accountId | externalId
```

The account key omits a separate external entity ID because `accountId` is the
account identity. Property, booking, guest, conversation, message, and event
keys include their external IDs. Therefore the same booking, property, or event
ID in two accounts creates different canonical identities.

The v1 event idempotency rule is:

```text
partnerId + accountId + eventId
```

No phone, email, property label, guest name, or booking-reference heuristic may
establish partner tenant authority when `PartnerCommunicationContext` exists.

## Safe validation errors

- `partner_contract_invalid`
- `partner_schema_version_unsupported`
- `partner_event_type_unsupported`
- `partner_identity_invalid`
- `partner_booking_state_invalid`
- `partner_message_invalid`

Errors contain only the stable code. They do not reveal internal UUIDs,
database matches, secrets, stack traces, or whether another tenant owns an ID.

## ASI to partner

The response schema is `partner.communication.response.v1`.

```json
{
  "schemaVersion": "partner.communication.response.v1",
  "accepted": true,
  "duplicate": false,
  "auditRef": "opaque-reference",
  "identity": {
    "partnerId": "partner-demo",
    "accountId": "account-1",
    "propertyId": "property-101",
    "bookingId": "booking-5001",
    "guestId": "guest-77",
    "conversationId": "conversation-900",
    "messageId": "message-1",
    "eventId": "partner-event-1"
  },
  "decision": {
    "type": "reply",
    "text": "Сеть Wi-Fi: ASI-Demo. Пароль: demo-wifi-2026.",
    "confidence": 0.99,
    "policy": "auto_allowed",
    "reasonCodes": ["grounded_wifi"]
  },
  "operationalActions": [],
  "handoff": null,
  "resultingState": {
    "conversation": "active",
    "issue": "none",
    "operatorRequired": false
  }
}
```

The decision is a durable recommendation. `auto_allowed` never means automatic
delivery: no guest message is sent. Escalations can include a durable pending
handoff and a recommended operational action, but neither invokes an external
system.

## Synthetic simulator

`src/lib/partner-communication/synthetic.ts` contains an explicitly synthetic
Apart Sharing-style input fixture. Focused processor tests bind it to synthetic
Apartment 101 knowledge (`ASI-Demo` / `demo-wifi-2026`) and prove a grounded
reply plus identical replay. It does not call an LLM, provider, delivery adapter,
or external service.

## Out of scope

Future event names such as `property.upsert`, `booking.upsert`,
`message.delivery.updated`, `operation.updated`, `incident.resolved`, and
`feedback.received` are not supported in v1. Webhook authentication, secrets,
partner connections, durable queues, retries, Review Engine, pricing,
outbound sends, UI, migrations, and deployment remain separate tasks.
