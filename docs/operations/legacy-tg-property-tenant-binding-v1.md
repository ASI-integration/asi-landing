# Legacy Telegram property tenant binding v1

## Model

`public.legacy_tg_property_bindings` is the server-owned transition bridge from
the text `tg_property_knowledge.property_id` namespace to a canonical
`properties(account_id, id)` row. The composite foreign key prevents a legacy
property from being bound to a canonical property owned by another account.
The table is service-role-only and has forced RLS; public client roles receive
no grants.

The operator-review resolver accepts this evidence only when one exact
`tg_guest_reservations` row matches the supplied reservation identity and its
`property_id` equals the review property. Missing, duplicate, or conflicting
reservation/property/account evidence fails closed.

## Rollout and backfill

1. Prefer applying `20260821191132_legacy_tg_property_tenant_binding_v1.sql`
   before deploying the code. Deploying code first is fail-closed and preserves
   existing `booking_ops_records`-backed reviews, but no-booking-ops legacy
   reviews remain hidden until the migration and required binding rows exist.
2. Create or identify the canonical `public.properties` row for each active
   legacy Telegram communication property.
3. Backfill one row per active text property into
   `public.legacy_tg_property_bindings`, using the exact legacy
   `tg_property_knowledge.property_id`, the owning `accounts.id`, and the
   canonical `properties.id` owned by that same account.
4. Before deploying code, bind at minimum every active text property used by a
   no-booking-ops operator-review path. For the known path this means the exact
   `tg_property_knowledge` row whose `property_id` is `test-prop-tg-live`.
   Its exact production `account_id` and canonical property UUID must be chosen
   by the owner from existing canonical records; this artifact does not guess or
   mutate either value.
5. Verify each binding read-only by joining the bridge to `accounts`,
   `properties`, `tg_property_knowledge`, and active `tg_guest_reservations` on
   the exact property id. Confirm that every reservation resolves to exactly one
   legacy property and one canonical tenant.
6. Deploy the reviewed application commit only after the migration and required
   bindings exist. No automatic message send is enabled by this rollout.

Existing production rows require backfill only when their text property ids are
used by operator-review communication paths. Unbound rows intentionally remain
hidden and all operator mutations remain forbidden.

## Rollback

Roll back application code first. The bridge table can remain unused without
affecting legacy communication data. After confirming no deployed code reads it,
drop `public.legacy_tg_property_bindings` in a separately approved production
migration. Dropping the bridge does not delete `tg_property_knowledge`,
`tg_guest_reservations`, `properties`, or `accounts` rows.
