-- Generated using Supabase CLI 3.1.0 "migration new ota_finance_transaction_audit_v1".
-- SOURCE PROPOSAL ONLY: do not apply to shared staging or production.
-- Owner-reviewed transaction code must append this event in the SAME transaction
-- as the imported statement and all cash events.
-- A COMMITTED_UNVERIFIED audit entry is NOT evidence of an OTA/bank settlement.
create table ota_finance_private.operation_audit (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete restrict,
  property_id uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  statement_import_id uuid not null,
  provider text not null check (length(provider) between 1 and 100),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  operation_kind text not null default 'operator_statement_import'
    check (operation_kind = 'operator_statement_import'),
  event_count integer not null check (event_count between 1 and 50),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null default 'COMMITTED_UNVERIFIED'
    check (outcome = 'COMMITTED_UNVERIFIED'),
  committed_at timestamptz not null default now(),
  constraint finance_audit_operation_unique unique (account_id, operation_id),
  constraint finance_audit_statement_scope_fk
    foreign key (statement_import_id, account_id, property_id, provider, currency)
    references ota_finance_private.statement_imports
      (id, account_id, property_id, provider, currency) on delete restrict,
  constraint finance_audit_property_tenant_fk
    foreign key (property_id, account_id)
    references public.properties(id, account_id) on delete restrict
);

create index finance_audit_scope_date on ota_finance_private.operation_audit
  (account_id, property_id, committed_at desc);

alter table ota_finance_private.operation_audit enable row level security;
revoke all on table ota_finance_private.operation_audit
  from public, anon, authenticated, service_role;
grant select, insert on table ota_finance_private.operation_audit to service_role;
