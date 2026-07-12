-- OPS v17 zero-touch pilot onboarding. Service-role only; no outbound messaging triggers.
create table if not exists public.ops_v17_onboardings (
  id uuid primary key,
  account_id text not null unique,
  current_step text not null default 'business' check (current_step in ('business','owner','properties','units','operations','channel_manager','communications','legal_payments','staff','verification','launch')),
  data jsonb not null default '{}'::jsonb,
  progress integer not null default 0 check (progress between 0 and 100),
  pilot_activated_at timestamptz,
  pilot_activated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ops_v17_module_state (
  onboarding_id uuid not null references public.ops_v17_onboardings(id) on delete cascade,
  module_key text not null,
  status text not null check (status in ('pending','initialized','blocked')),
  idempotency_key text not null unique,
  detail text,
  updated_at timestamptz not null default now(),
  primary key (onboarding_id, module_key)
);
create table if not exists public.ops_v17_maintenance_tasks (
  id uuid primary key,
  onboarding_id uuid not null references public.ops_v17_onboardings(id) on delete cascade,
  property_key text not null,
  verification_key text not null,
  status text not null default 'open' check (status in ('open','in_progress','awaiting_reinspection','closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(onboarding_id, property_key, verification_key, status)
);
create table if not exists public.ops_v17_channel_checkpoints (
  onboarding_id uuid not null references public.ops_v17_onboardings(id) on delete cascade,
  provider text not null,
  stream text not null,
  checkpoint text not null,
  idempotency_key text not null unique,
  health_status text not null default 'configuration_required' check (health_status in ('configuration_required','credentials_required','validating','connected','initial_sync','synchronized','degraded','disconnected','blocked')),
  updated_at timestamptz not null default now(),
  primary key(onboarding_id, provider, stream)
);
create table if not exists public.ops_v17_audit_log (
  id uuid primary key,
  onboarding_id uuid not null references public.ops_v17_onboardings(id) on delete cascade,
  action text not null,
  actor_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ops_v17_audit_onboarding_created_idx on public.ops_v17_audit_log(onboarding_id, created_at desc);
alter table public.ops_v17_onboardings enable row level security;
alter table public.ops_v17_module_state enable row level security;
alter table public.ops_v17_maintenance_tasks enable row level security;
alter table public.ops_v17_channel_checkpoints enable row level security;
alter table public.ops_v17_audit_log enable row level security;
revoke all on public.ops_v17_onboardings, public.ops_v17_module_state, public.ops_v17_maintenance_tasks, public.ops_v17_channel_checkpoints, public.ops_v17_audit_log from anon, authenticated;
grant all on public.ops_v17_onboardings, public.ops_v17_module_state, public.ops_v17_maintenance_tasks, public.ops_v17_channel_checkpoints, public.ops_v17_audit_log to service_role;
