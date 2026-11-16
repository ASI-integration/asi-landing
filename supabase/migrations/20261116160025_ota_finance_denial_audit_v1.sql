-- SOURCE-ONLY proposal generated with Supabase CLI migration new.
-- NOT APPLIED to staging or production. Requires approved release gate.
-- A denied authorization can lack a valid account, property, or actor.
-- Store only a cryptographic digest of the supplied scope, never guest data.
create table ota_finance_private.access_denials (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  action text not null check (
    action in ('read', 'import', 'review', 'fee_rule', 'invalid_action')
  ),
  reason_code text not null check (
    reason_code ~ '^FINANCE_[A-Z0-9_]{3,95}$'
  ),
  scope_sha256 text not null check (scope_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null default 'DENIED' check (outcome = 'DENIED'),
  denied_at timestamptz not null default now()
);

create index access_denials_recent_idx on ota_finance_private.access_denials
  (denied_at desc, id desc);

alter table ota_finance_private.access_denials enable row level security;
revoke all on table ota_finance_private.access_denials
  from public, anon, authenticated, service_role;
grant select, insert on table ota_finance_private.access_denials to service_role;
