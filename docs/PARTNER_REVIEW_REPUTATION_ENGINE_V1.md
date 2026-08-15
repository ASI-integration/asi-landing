# Partner Review & Reputation Engine v1

## Purpose and boundary

The v1 loop is:

`Stay Experience -> Recovery Context -> Review -> Classification -> Safe Response Draft -> Root Cause Signal -> Recurring Reputation Intelligence`

The engine ingests a guest accommodation review, links it to the exact authenticated partner account, property, and booking, records deterministic analysis, and prepares an unpublished response draft. The adjacent reputation route keeps public guest reviews separate from the existing operator approval/review domain and avoids distorting communication-message storage.

V1 does not publish a response, call a real OTA or review-platform adapter, delete or report reviews, manipulate ratings, contact a reviewer, create an operational task, or issue compensation. `apart-sharing-demo`, `booking`, `airbnb`, `avito`, `ostrovok`, and `partner-import` are only opaque source labels; no provider adapter is implied.

## Authenticated event contract

`POST /api/partner/v1/reputation/events`

The request uses the existing partner credential authentication. The credential resolves the internal partner account binding. Request identity is then mapped through active property and booking bindings to the canonical tenant, property, and booking. Guest identity is neither required nor authoritative, and there is no fuzzy matching.

```json
{
  "schemaVersion": "partner.reputation.v1",
  "eventId": "event-123",
  "eventType": "review.received",
  "occurredAt": "2026-08-15T12:00:00.000Z",
  "partner": { "partnerId": "partner-demo", "accountId": "partner-account" },
  "property": { "propertyId": "external-property" },
  "booking": { "bookingId": "external-booking" },
  "review": {
    "reviewId": "review-123",
    "source": "partner-import",
    "rating": 8,
    "ratingScale": 10,
    "title": null,
    "text": "Хорошее проживание.",
    "language": "ru",
    "publishedAt": "2026-08-15T11:00:00.000Z"
  }
}
```

Unknown fields, malformed identifiers, empty review text, ratings at or below zero, scales outside `1..100`, and ratings above the declared scale are rejected. Rating-only reviews are intentionally not supported in v1. Normalization is `normalizedRating = rating / ratingScale`, rounded to six decimal places and constrained to `[0,1]`; therefore `8/10` and `4/5` both normalize to `0.8`.

## Durable model and idempotency

The additive migration creates three service-role-only, FORCE-RLS tables:

- `partner_guest_reviews` stores canonical scope, opaque `prev_...` reference, source identity, rating, deterministic analysis, bounded recovery facts, and unpublished response draft.
- `partner_review_events` is the authenticated event ledger with opaque `pra_...` audit reference, request fingerprint, durable response, and terminal safe error state.
- `partner_reputation_signals` stores idempotent category-level operational intelligence without creating a task.

Composite foreign keys and a scope trigger bind every review to its partner binding and exact canonical property/booking. Reputation signals use a composite review/property/booking foreign key. Anonymous and authenticated roles have no table access.

Uniqueness on authenticated event identity makes concurrent exact replay converge. The same event ID and normalized content returns the same stored review, analysis, and draft with `duplicate: true`; changed content returns `409 partner_event_conflict`. Uniqueness on `(partner_account_binding_id, source, external_review_id)` makes one logical review authoritative. Conflicting content for that identity returns `409 partner_review_conflict`, while identical external IDs in different tenant bindings remain isolated. Signal uniqueness is `(account_id, review_id, category)`.

## Deterministic analysis

Classification uses both normalized rating and bounded Russian/English text patterns. Outputs are:

- sentiment: `positive`, `mixed`, or `negative`;
- severity: `low`, `medium`, `high`, or `critical`;
- a bounded category subset: cleanliness, maintenance, heating, water, access, check-in/out, communication, noise, Wi-Fi, parking, amenities, accuracy, value, safety, payment, staff, or other;
- reputation risk: `low`, `medium`, `high`, or `critical`.

Low ratings remain negative even without category words. Positive high-rated text that truthfully says a problem was resolved is not made severely negative merely by an issue keyword. Safety, theft, injury, discrimination, legal, payment/refund, and personal-data wording is treated as an allegation, never established fact, and requires human review.

## Recovery correlation

Recovery lookup is restricted to the authenticated account plus exact external partner account, property, and booking, and only cases opened before review publication/receipt are considered. It never correlates by guest name or text similarity and never crosses tenants.

The durable context is one of `no_recovery_case`, `recovered_before_review`, `unrecovered_before_review`, `awaiting_guest_confirmation`, or `multiple_recovery_cases`. Up to five bounded facts include category, outcome, timestamps, and available latency metrics. Multiple cases are summarized without claiming that a particular case caused a particular sentence; mixed recovery outcomes require human review.

## Reputation risk and response policy

Risk combines rating, sentiment, sensitive allegations, and recovery outcome. Routine positive reviews are low risk. Very low ratings, negative reviews, and unrecovered cases increase risk; serious allegations are critical.

The response recommendation contains `text`, `policy`, and `reasonCodes`. `draft_safe` is limited to routine or truthfully recovered cases. Unrecovered, pending, multiple-case, negative high-risk, and sensitive cases use `review_required`; `blocked` is the fail-closed policy if the manipulation guard ever rejects generated text. A draft may mention resolution only when recovery data confirms it.

The explicit manipulation guard rejects requests to delete a review, change a score, give five stars, exchange incentives for changes, apply threats or pressure, or condition a refund, compensation, or discount on review behavior. Drafts never promise refunds or compensation, admit legal liability, accuse the guest, or disclose booking, staff, or internal incident data.

## Intelligence helpers

The server-only property helper accepts an authenticated tenant/property scope and a 30- or 90-day window. It returns review count, average normalized rating, negative count/rate, top categories, category counts, recovered and unresolved-recovery-linked counts, and recurring issues. A category becomes recurring at four reviews. A trend remains `insufficient_sample` below eight reviews.

The recovery-effectiveness helper returns observational recovered and unrecovered cohorts with sample size, negative-review rate, and average normalized rating. Empty cohorts return `null` metrics. It makes no causal or revenue claim.

## Synthetic acceptance scenarios

| Scenario | Result |
| --- | --- |
| 5/5, heating issue resolved and guest satisfied | positive, heating + maintenance, recovered, low risk, truthful `draft_safe` response |
| 2/5, issue not resolved | negative, unrecovered, high risk, `review_required`, no resolution claim |
| 5/5, clean and convenient | positive, cleanliness, low risk, short `draft_safe` response, no root-cause alarm |
| 1/5, missing belongings allegation | negative, safety/theft allegation, critical, `review_required`, no admission or accusation |

Existing operator escalation review remains a separate domain and is not changed by this engine.
