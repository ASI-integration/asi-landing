# Staging-only Supabase SQL

These files are **not** part of `supabase/migrations` and must not be applied to production.

## Runtime Bridge free-tier schema

Files:
- `20260909170000_runtime_bridge_schema_free_tier.sql` (historical bootstrap; do not rewrite)
- `20260912210000_runtime_bridge_single_lane_admission_v1.sql` (forward single-lane admission)

Free-tier staging exception: Bridge shares the staging Supabase project but uses dedicated runtime_bridge schema. Production requires isolated Bridge storage.

Apply only to the existing **asi-staging** project (SQL editor), then expose schema `runtime_bridge` in Dashboard → Settings → API → Exposed schemas.

Keep env names:

- `ASI_RUNTIME_BRIDGE_SUPABASE_URL`
- `ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY`
- `ASI_RUNTIME_BRIDGE_CLIENT_ID`

Staging may point URL/key at the same staging project. Set `ASI_RUNTIME_BRIDGE_SUPABASE_SCHEMA=runtime_bridge`. Do not copy this shared-database setup into production.
