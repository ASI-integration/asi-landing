# YooKassa Payment Readiness v1 (ASI MVP)

TEST-MODE / repository readiness only. Live payments are **not** enabled.

## Architecture

```
Client → POST /api/yookassa/create-payment (productId only)
      → server catalog amount (RUB)
      → YooKassa createPayment (Idempotence-Key)
      → redirect UX

YooKassa → POST /api/webhooks/yookassa
        → parse event (hint)
        → GET /payments/{id} (authoritative)
        → match internal payment + amount/currency
        → mark paid once
        → activateEntitlementForPaidPayment (idempotent)

Return → /payments/return?paymentId=…
      → GET /api/payments/status (server state only)
```

Existing seams reused:

- `src/lib/payments/*` provider factory / DB / webhook dedupe
- `operational_payments` (+ readiness migration columns)
- Catalog product: `communication_pilot_object_month` (1000 RUB)

## Test-mode setup

```bash
YOOKASSA_ENABLED=true
YOOKASSA_MODE=test
YOOKASSA_SHOP_ID=...          # test shop id from ЮKassa cabinet
YOOKASSA_SECRET_KEY=test_...  # must look like a test key
YOOKASSA_FORCE_TEST_KEY=true  # only for local mocked secrets in unit tests
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Local/CI unit tests **mock** HTTP (`setYooKassaHttpForTests`) — no real YooKassa calls.

## Required env vars (placeholders only)

| Name | Purpose |
| --- | --- |
| `YOOKASSA_ENABLED` | Must be `true` to create/handle payments |
| `YOOKASSA_MODE` | `test` (default) or `live` |
| `YOOKASSA_ALLOW_LIVE` | Required `true` before live mode works |
| `YOOKASSA_SHOP_ID` | Shop ID |
| `YOOKASSA_SECRET_KEY` | Secret key (server-only) |
| `NEXT_PUBLIC_APP_URL` | Base URL for return links |

Never put secrets in `NEXT_PUBLIC_*` or client bundles.

## Webhook URL

```
https://<your-domain>/api/webhooks/yookassa
```

Alias (same handler): `/api/payments/webhook`  
Retired: `/api/yookassa/webhook` → 410

## Return URL

```
https://<your-domain>/payments/return?paymentId=<internal-id>&service=communication_pilot_object_month
```

Return URL is **UX only**. Query flags like `?paid=true` are ignored.

## Payment states

`pending` → `paid` | `cancelled` | `failed` | `expired`  
Terminal `paid` cannot be downgraded by stale webhook events.

## Idempotency

- Create uses stable `idempotency_key` as YooKassa `Idempotence-Key`
- Retry with the same key returns the same internal payment
- Webhook events are deduped via `payment_event_dedup`
- Entitlement activation runs at most once per payment

## 54-FZ / receipts — unresolved inputs

Do **not** invent fiscal settings. `buildYooKassaReceiptDraft()` returns `null` until product/legal decides:

- legal entity / ИП receiving payment
- tax system
- VAT code
- payment subject / payment mode
- customer email requirement
- "Чеки от ЮKassa" vs external online cash register

The createPayment body can attach `receipt` later without rewriting payment core.

## PRODUCTION ACTIVATION — NOT DONE

Checklist (owner only; not executed by this PR):

1. Resolve 54-FZ / receipt inputs and enable receipt draft.
2. Configure live shop credentials in production secrets (not in git).
3. Set `YOOKASSA_MODE=live` and `YOOKASSA_ALLOW_LIVE=true` only in production.
4. Confirm webhook URL on the live shop points to `/api/webhooks/yookassa`.
5. Apply migration `20260916180000_yookassa_payment_readiness_v1.sql` via AO-004 owner-gated process.
6. Run a **live** smoke with a real small payment and refund/cancel policy agreed.
7. Keep AO-003 owner-gate / environment reviewers for any production deploy that enables live mode.
8. Do not enable recurring autopay until product explicitly requires it.
