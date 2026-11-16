-- CANDIDATE ONLY, NOT AN APPLIED SUPABASE MIGRATION.
-- Strigunov OTA Finance V1: server-only private append-oriented schema.
-- Requires separate disposable-Postgres RLS/DDL tests and explicit owner approval
-- before translation to an official Supabase CLI migration.
-- Do not execute on the live Supabase project at this stage.
begin;

-- btree_gist enforces conflict-free, race-safe effective-date ranges.
create extension if not exists btree_gist;

-- Composite FK guarantees a property cannot be attributed to another tenant.
-- This additional unique index is part of the future migration review.
create unique index if not exists properties_id_account_for_ota_finance
  on public.properties (id, account_id);

create schema if not exists ota_finance_private;
revoke all on schema ota_finance_private from public, anon, authenticated;
grant usage on schema ota_finance_private to service_role;

-- Fee rules are immutable version records, not editable current balances.
create table ota_finance_private.fee_rule_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  property_id uuid not null,
  provider text not null check (length(provider) between 1 and 100),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  contract_key text not null check (length(contract_key) between 1 and 200),
  version integer not null check (version > 0),
  effective_from date not null,
  effective_through date,
  commission_bps integer not null check (commission_bps between 0 and 10000),
  fixed_minor bigint not null check (fixed_minor between 0 and 1000000000000),
  fee_base text not null check (fee_base in ('gross','gross_less_refunds')),
  collection_method text not null
    check (collection_method in ('withheld_from_payout','separate_invoice')),
  charge_on_cancellation boolean not null,
  source_digest_sha256 text not null
    check (source_digest_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  constraint fee_rule_valid_range check (
    effective_through is null or effective_through >= effective_from
  ),
  unique(account_id, property_id, provider, currency, contract_key, version),
  constraint fee_rule_property_tenant_fk
    foreign key (property_id, account_id)
    references public.properties (id, account_id) on delete restrict,
  constraint fee_rule_no_overlapping_periods
    exclude using gist (
      account_id with =, property_id with =, provider with =,
      currency with =, contract_key with =,
      daterange(effective_from, effective_through, '[]') with &&
    )
);

create index fee_rule_versions_scope_date on ota_finance_private.fee_rule_versions (
  account_id, property_id, provider, currency, effective_from
);

-- Operator-normalized statements remain UNVERIFIED as imported. The raw
-- bank/OTA file is NOT stored here, nor is its authenticity presumed.
create table ota_finance_private.statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  property_id uuid not null,
  provider text not null check (length(provider) between 1 and 100),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  statement_external_id text not null
    check (length(statement_external_id) between 1 and 200),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  provenance text not null default 'OPERATOR_SUPPLIED_NORMALIZED_CSV'
    check (provenance = 'OPERATOR_SUPPLIED_NORMALIZED_CSV'),
  source_status text not null default 'UNVERIFIED_OPERATOR_IMPORT'
    check (source_status = 'UNVERIFIED_OPERATOR_IMPORT'),
  as_of_date date not null,
  imported_at timestamptz not null default now(),
  unique(account_id, property_id, provider, currency, statement_external_id),
  unique(id, account_id, property_id, provider, currency),
  constraint statement_property_tenant_fk
    foreign key (property_id, account_id)
    references public.properties (id, account_id) on delete restrict
);

-- Strict append-only movement ledger. A revision/correction is a NEW event.
-- A CSV row cannot prove actual bank clearance; status remains unverified.
create table ota_finance_private.cash_events (
  id uuid primary key default gen_random_uuid(),
  statement_import_id uuid not null,
  account_id uuid not null,
  property_id uuid not null,
  provider text not null check (length(provider) between 1 and 100),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  booking_id text not null check (length(booking_id) between 1 and 200),
  external_event_id text not null
    check (length(external_event_id) between 1 and 200),
  kind text not null check (kind in (
    'payout_received', 'payout_adjustment_credit',
    'payout_adjustment_debit', 'refund_debit', 'separate_fee_paid'
  )),
  amount_minor bigint not null check (amount_minor between 0 and 1000000000000),
  claimed_settled_on date not null,
  source_status text not null default 'UNVERIFIED_OPERATOR_IMPORT'
    check (source_status = 'UNVERIFIED_OPERATOR_IMPORT'),
  recorded_at timestamptz not null default now(),
  constraint cash_event_statement_scope_fk
    foreign key (statement_import_id, account_id, property_id, provider, currency)
    references ota_finance_private.statement_imports
    (id, account_id, property_id, provider, currency) on delete restrict,
  unique(account_id, property_id, provider, currency, external_event_id),
  constraint cash_event_property_tenant_fk
    foreign key (property_id, account_id)
    references public.properties (id, account_id) on delete restrict
);

create index cash_events_booking_scope on ota_finance_private.cash_events (
  account_id, property_id, provider, currency, booking_id, claimed_settled_on
);

-- Human review is a separate immutable event, never an edit to source data.
-- This only attests to operator review, NOT bank settlement authenticity.
create table ota_finance_private.statement_reviews (
  id uuid primary key default gen_random_uuid(),
  statement_import_id uuid not null,
  account_id uuid not null,
  property_id uuid not null,
  provider text not null,
  currency text not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  outcome text not null check (outcome in ('accepted_for_review','rejected')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  foreign key (statement_import_id, account_id, property_id, provider, currency)
    references ota_finance_private.statement_imports
    (id, account_id, property_id, provider, currency) on delete restrict,
  constraint statement_review_property_tenant_fk
    foreign key (property_id, account_id)
    references public.properties (id, account_id) on delete restrict
);

-- Private schema is NOT exposed through the Supabase Data API by default.
-- RLS is enabled nevertheless; no direct anon/authenticated policies exist.
alter table ota_finance_private.fee_rule_versions enable row level security;
alter table ota_finance_private.statement_imports enable row level security;
alter table ota_finance_private.cash_events enable row level security;
alter table ota_finance_private.statement_reviews enable row level security;

revoke all on table
  ota_finance_private.fee_rule_versions,
  ota_finance_private.statement_imports,
  ota_finance_private.cash_events,
  ota_finance_private.statement_reviews
from public, anon, authenticated, service_role;

-- Only server-side service_role may SELECT or INSERT (never UPDATE/DELETE).
-- A privileged server role bypasses RLS; server code MUST verify account
-- membership and property scope before every operation.
grant select, insert on table
  ota_finance_private.fee_rule_versions,
  ota_finance_private.statement_imports,
  ota_finance_private.cash_events,
  ota_finance_private.statement_reviews
to service_role;

commit;
