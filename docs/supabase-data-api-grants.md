# Supabase Data API grants

Last audited: 2026-05-14

Supabase is changing the default exposure model for new tables in the `public`
schema. Starting May 30, 2026, new Supabase projects default to requiring
explicit Postgres `GRANT` statements before new public-schema tables are visible
through the Data API or GraphQL API. On October 30, 2026, Supabase plans to apply
the same default to existing projects for newly created tables. Existing tables
keep their current grants.

References:

- [Supabase changelog: tables not exposed automatically](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [Supabase docs: securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase pricing: Free project pausing](https://supabase.com/pricing)

## Current project usage

The app uses Supabase through the server-side client in
`src/lib/supabase.ts`. That client requires:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is not present in `.env.example` and was not
found in application code. There is no browser Supabase client, direct
`/rest/v1/` call, PostgREST fetch wrapper, or GraphQL usage in this repo.

Because the server client uses `@supabase/supabase-js`, it still reaches tables
through Supabase's Data API. For new internal tables, grant only the privileges
the server-side `service_role` client needs. Do not grant `anon` or
`authenticated` unless the table is intentionally accessed directly from a
public or signed-in client.

If the Supabase project is paused, the following app areas can fail:

- Auth and account APIs: login, signup, Google callback, session, onboarding,
  account membership, channel listing.
- Billing and payment APIs: Stripe/YooKassa payment creation, webhooks,
  subscription status checks, trial cron.
- Communication runtime: Telegram/VK/WhatsApp/phone/MAX/email intake,
  conversation memory, templates, property knowledge, reservations,
  idempotency, dead-letter/event persistence.
- Operations runtime: ops tasks, unit state, stay-flow readiness,
  operations dashboard persistence.
- Distribution runtime: OTA/channel connections, listings, availability, rates,
  reservations, sync jobs/events, idempotency.
- Location persistence: location analysis cache, async full-report requests,
  standalone report storage.
- Diagnostic scripts: `scripts/ru-supabase-last-replies.mjs` and
  `scripts/ru-supabase-dump-turns.mjs`.

Supabase documents that Free Plan projects may be paused after low activity in a
7-day period. Paid plans are the durable fix; keep-alive traffic should not be
treated as a production reliability plan.

## Access classification

No current table is intentionally accessed by an anonymous browser client.

No current table is intentionally accessed by an authenticated browser client.
`subscriptions` has a historical "users select own subscription" RLS policy, but
the current app code still uses the server-side service-role client.

Server-only/service-role tables found in code or migrations:

- Core auth/billing: `users`, `sessions`, `subscriptions`, `payments`,
  `operational_payments`.
- Accounts/workspace: `accounts`, `account_members`, `properties`, `channels`,
  `conversations`, `message_turns`.
- Communication: `tg_contacts`, `tg_conversations`,
  `tg_conversation_sessions`, `tg_message_turns`, `tg_guest_identities`,
  `tg_guest_reservations`, `tg_property_knowledge`, `pending_messages`,
  `comm_dlq`, `comm_events`.
- Operations: `ops_tasks`, `unit_state`, `operations_items`,
  `operations_issues`, `operations_notes`, `operations_audit_events`,
  `operations_checklist_items`.
- Distribution: `dist_distribution_channels`, `dist_ota_accounts`,
  `dist_property_channel_connections`, `dist_channel_listings`,
  `dist_rate_plans`, `dist_availability_days`, `dist_rate_days`,
  `dist_channel_reservations`, `dist_sync_jobs`, `dist_sync_events`,
  `dist_idempotency_keys`.
- Location: `location_analysis_cache`, `location_report_requests`,
  `location_standalone_reports`.

Tables that should never be public include all user, payment, account member,
operations, reservation, guest identity, communication, property knowledge,
channel account/config, audit, dead-letter, idempotency, and report-request
tables. Several contain PII, credentials/config JSON, operational status, guest
messages, payment state, or paid-report payloads.

## Migration audit

`CREATE TABLE` statements were found in:

- `supabase/migrations/*.sql`
- `scripts/migrations/001_location_analysis_cache.sql`
- draft/reference SQL under `docs/migrations/*.sql`

No explicit `GRANT` statements were found in the applied Supabase migrations.
Some migrations later enable RLS and add service-role-only policies, and
`20260415000001_enable_rls_security_advisor_public_tables.sql` explicitly
revokes `anon` and `authenticated` from many tables. Future migrations should
place grant/revoke intent next to the table creation so the Data API exposure
model is clear at review time.

Do not retroactively change production grants from this repo without a separate
database change plan and verification against the live project.

## Safe templates

Public read-only table, only when anonymous users are meant to read it directly:

```sql
create table if not exists public.example_public_catalog (
  id uuid primary key default gen_random_uuid(),
  label text not null
);

alter table public.example_public_catalog enable row level security;

grant select
on table public.example_public_catalog
to anon;

create policy "public_read_example_public_catalog"
  on public.example_public_catalog
  for select
  using (true);
```

Signed-in client table, only when browser clients use Supabase Auth directly:

```sql
create table if not exists public.example_user_table (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  label text not null
);

alter table public.example_user_table enable row level security;

grant select, insert, update, delete
on table public.example_user_table
to authenticated;

create policy "users_manage_own_example_user_table"
  on public.example_user_table
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

Current ASI default for internal tables used through `src/lib/supabase.ts`:

```sql
create table if not exists public.example_internal_table (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.example_internal_table enable row level security;

revoke all
on table public.example_internal_table
from anon, authenticated;

grant select, insert, update, delete
on table public.example_internal_table
to service_role;

create policy "service_role_full_access"
  on public.example_internal_table
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
```

If a table uses sequences, also grant only the required sequence privileges to
the same role. UUID defaults such as `gen_random_uuid()` do not need sequence
grants.

Unsafe examples:

```sql
grant all on all tables in schema public to anon;
grant select, insert, update, delete on public.payments to anon;
grant select on public.users to anon;
grant select on public.tg_guest_reservations to authenticated;
```

## New migration checklist

- Classify the table before writing grants: public read, authenticated client,
  service-role only, or never public.
- Prefer service-role-only for this repo unless a real browser Supabase client
  is introduced.
- Keep RLS enabled for public-schema tables.
- Add explicit `revoke all ... from anon, authenticated` for internal tables.
- Add explicit `grant ... to service_role` when server-side Supabase JS must use
  the Data API for the table.
- Grant `anon` only for truly public read-only data.
- Grant `authenticated` only for direct Supabase Auth client flows, with matching
  per-user or per-tenant RLS policies.
- Do not expose user, admin, payment, operations, reservation, communication,
  credential/config, audit, idempotency, or report payload tables to `anon`.
- Run `node scripts/check-supabase-data-api-grants.mjs` before review. The script
  is advisory and currently exits successfully with warnings.
