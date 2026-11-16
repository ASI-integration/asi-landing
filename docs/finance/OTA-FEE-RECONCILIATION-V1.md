# OTA fee and payout reconciliation ??? V1 calculation core

Status: **LOCAL CANDIDATE ONLY**, no deployed API, no database migration, no provider integration.
Scope: internal, read-only computation of expected commission, cash settlement and provisional net after allocated Channel Manager costs.

## Non-negotiable boundaries

- OTA integration and actual financial data are **not available** until a verified connection, export or signed feed is configured.
- Every provider contract is configured explicitly per provider, currency and booking-date validity. **No default commission percentages or invented settlement schedules.**
- Actual settlements must come from a cleared source statement and carry an effective settlement date. An anticipated payment date is not a cleared payout.
- Minor units only (e.g. Russian kopecks), integer commission basis points and BigInt half-up rounding. Never combine currencies; no implicit FX conversion.
- Booking changes are represented by a new booking snapshot/revision. Previously cleared bank events are immutable; cancelled bookings and partial refunds recalculate expected values.
- A payout **withheld** by the OTA and a fee **invoiced separately** are different money movements. Never count both forms as a second commission.
- Channel Manager subscription/commission is a **separate property expense**. An approved allocation basis (bookings, occupied nights, or booking gross) distributes an invoice by explicitly provided weights; rounding remainder is retained deterministically. Missing allocation stays visible.
- Pending versus overdue is determined by an **explicit configured due date**; without one the result is unscheduled, not overdue.
- Confirmed tax, merchant processing charges, insurance, chargebacks, clawbacks, booking-specific accommodation taxes, FX and statutory accounting treatment are **not modeled** yet. The computed value is *provisional commercial net*, not audited profit or taxable income.
- This module **never** sends money, creates invoices, pulls bank records, publishes rates, edits bookings, or writes Supabase.

## V1 source API

`src/lib/ota-finance/ledger.ts` exports:

- `chooseFeeRule`: exact dated contract for one provider/currency; gaps and overlaps block calculation.
- `commissionFor`: percent + fixed fee with gross or post-refund basis, explicit cancellation treatment.
- `reconcileOtaBooking`: expected provider payout and separate fee, cleared payouts/refund/fees, late payment status, variance, provisional net.
- `allocateChannelManagerInvoice`: exact single-currency allocation of one CM expense; explicit allocation weights; unallocated cost visible.
- `projectChannelNet`: shadow price comparison net of commission and allocated CM cost. **Never a live OTA price push**.

## Example (illustrative only; not any platform's real tariff)

Assume a booking gross of 1,000.00 RUB (100,000 kopecks). Platform A hypothetically charges 15% plus 2.00 RUB, withholding 152.00 RUB from the payment. Expected net payout is 848.00 RUB. If allocated Channel Manager expense is 5.00 RUB, provisional income after those costs is 843.00 RUB.

Another provider might remit the whole 1,000.00 RUB on Nov 10 and charge its fee as a separate bank debit on Dec 5. The latter must appear as outstanding through Dec 4 and settled only after the cleared Dec 5 event. This is distinct from withheld commission.

## Offline normalized CSV intake candidate (V1.1; not a provider connector)

`src/lib/ota-finance/statement-csv.ts` offers `parseOtaCashCsv`, a **pure** importer for a deliberately strict, operator-normalized CSV export. A real provider's raw file may use different columns and must first be mapped and reviewed by an authorized human.

The supported nine-column header is exactly:

```csv
account_id,property_id,booking_id,provider,currency,event_id,kind,amount_minor,settled_on
```

`amount_minor` is an **integer** (e.g. 84800 = 848.00 RUB). Dates use `YYYY-MM-DD`. The permitted cash kinds are `payout_received`, `payout_adjustment_credit`, `payout_adjustment_debit`, `refund_debit`, and `separate_fee_paid`.

The caller must explicitly supply a tenant account, property, provider, currency, statement ID and as-of date. An import with another tenant/property/provider/currency, malformed money/date, unknown columns, duplicated-but-conflicting event identifiers, or purported future-cleared transactions **fails closed**. Even a successful result remains `UNVERIFIED_OPERATOR_IMPORT`; it is **not bank evidence**, not a record of completed payout and not evidence of real provider integration.

This candidate does not store real statements, perform HTTP requests, mutate booking metadata, send messages, schedule payouts or publish prices. It has no credentials, no Supabase connection and no banking access. The scope is limited to bounded CSV validation and deterministic normalization before a separate audit/approval system exists.

## Evidence gates for pilot activation (not yet met)

1. Obtain one participating property, OTA statements with explicit fee terms and payout calendars, an existing PMS/CM account and consent for controlled read-only processing.
2. Build tenant-isolated Postgres schema for fee rules, immutable booking revisions, immutable cash events, CM bills and reconciliation snapshots. Restrict with RLS; use audited, scoped service API and duplicate-safe ingestion.
3. Verify a real source adapter (or owner-reviewed CSV import) for reservation IDs, cancellation/refund changes, commission invoices and bank clearing dates. Never reuse opaque bank amounts across bookings without proven allocation.
4. Cross-check OTA revenue, fees, delayed debits and bank statements on at least one real property; flag unknown FX, taxes and provider charges.
5. Link provisional net returns to the **existing shadow pricing module** and operator dashboard. Require explicit human approval for any later publication. Live OTA rate push is a separate integration and acceptance milestone.
6. Only after these controls, consider automatically issuing owner statements or performing external actions, with dedicated explicit approvals and rollback.

## Acceptance examples

Tests include distinct OTA rates and fixed fees, date-effective policies, withheld versus later separately billed commissions, partial/full refunds, cancellations with/without fees, cleared versus future bank events, duplicate and conflicting movement IDs, property/account/currency boundaries, money overflow and uncertain schedules, CM invoice allocation and net channel comparison.

### Anti-overclaim notice
A PASS of these offline tests proves only a deterministic accounting **calculation foundation**, not real OTA access, live channel sync, live pricing, bank reconciliation or production finance readiness.
