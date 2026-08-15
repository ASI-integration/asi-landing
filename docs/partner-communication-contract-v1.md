# Partner Communication Contract v1

## Status and boundary

This document freezes a partner-neutral, server-only contract for one event:
`guest.message.received` under schema `partner.communication.v1`.

There is no Apart Sharing integration, public partner webhook, authentication,
signature verification, delivery, persistent partner mapping, queue, or
external provider call in this version. Apart Sharing-like names in the
synthetic fixture are examples only.

Partner-provided identity becomes authoritative only after a future
authenticated server-to-server boundary. Contract validation does not
authenticate a partner. Public guest input is never authoritative tenant scope
and must never be passed to `validateTrustedPartnerCommunicationEvent`.

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
    "type": "no_action",
    "text": null,
    "confidence": null,
    "policy": "review_required",
    "reasonCodes": ["contract_only"]
  },
  "operationalActions": [],
  "resultingState": {
    "conversation": "active",
    "issue": "none",
    "operatorRequired": false
  }
}
```

The decision and action fields are contracts for later communication and
operations layers. Contract v1 does not claim those layers have processed the
message.

## Synthetic simulator

`src/lib/partner-communication/synthetic.ts` contains an explicitly synthetic
Apart Sharing-style fixture. It validates the input, produces canonical keys,
and returns a review-required `no_action` envelope. It does not call an LLM,
provider, delivery adapter, database, or external service.

## Out of scope

Future event names such as `property.upsert`, `booking.upsert`,
`message.delivery.updated`, `operation.updated`, `incident.resolved`, and
`feedback.received` are not supported in v1. Webhook authentication, secrets,
partner connections, durable queues, retries, Review Engine, pricing,
outbound sends, UI, migrations, and deployment remain separate tasks.
