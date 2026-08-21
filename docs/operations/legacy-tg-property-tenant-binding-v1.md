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

## Empty canonical production state and Step 0

An empty `users`, `accounts`, `account_members`, and `properties` layer is an
expected first-rollout state, not evidence that an operator owns every legacy
property. Application authorization remains fail-closed in that state: a CRM
operator without a canonical user and persisted `account_members` row receives
no tenant access.

**Step 0 is a future owner-approved production action:** use the normal ASI
authentication flow to establish the operator's canonical `public.users` row.
The preferred path is the existing Google OAuth callback at
`src/app/api/auth/google/callback/route.ts`. It already creates or reuses the
canonical user, sets `session.userId`, calls `ensureAccountForUser()`, and
creates or reuses the canonical account and account membership. Do not execute
login, logout, OAuth, or session changes as part of a code-review task.

After that authentication completes, inspect the persisted account and
membership read-only and use those exact user and account UUIDs as bootstrap
inputs. The bootstrap must reuse these auth-created rows. It must not create a
second account merely because an earlier plan contained an owner-generated
account UUID. A supplied account UUID, membership, or role that conflicts with
the persisted rows blocks rollout.

Never fabricate `public.users`, synthesize password hashes, infer a user from
operator email, choose the first or only user/account, or treat session/email as
tenant evidence. The known legacy property `test-prop-tg-live` can be bound only
after the exact canonical user, account, and membership exist.

## Bootstrap/preflight tool

[`scripts/legacy-tg-first-tenant-bootstrap.mjs`](../../scripts/legacy-tg-first-tenant-bootstrap.mjs)
uses `LEGACY_TG_BOOTSTRAP_DATABASE_URL` and requires explicit account, user,
canonical property, legacy property, and reservation identifiers. It never
prints the connection string.

With no `--apply` flag it is read-only and reports `PASS`/`FAIL` for:

- exact canonical user existence for `--user-id`;
- canonical account existence;
- exact operator membership;
- canonical property existence;
- legacy property existence;
- one unambiguous legacy reservation matching that property;
- the persisted legacy binding;
- the same-account property/binding relationship;
- final `READY` or `BLOCKED` deployment readiness.

Example read-only invocation (replace every placeholder with an owner-selected
value; do not reuse these labels as data):

```powershell
$env:LEGACY_TG_BOOTSTRAP_DATABASE_URL = '<owner-provided database connection>'
node scripts/legacy-tg-first-tenant-bootstrap.mjs `
  --account-id '<account UUID>' `
  --user-id '<operator user UUID>' `
  --property-id '<canonical property UUID>' `
  --legacy-property-id 'test-prop-tg-live' `
  --reservation-id '<exact legacy reservation identity>'
```

The tool exits `0` only for `READY`, `2` for a valid but blocked preflight, and
`1` for an input/query error.

The optional apply mode is a separately owner-approved production data
mutation. It is not part of application deployment and must not be run without
that exact approval. It requires the exact auth-created user/account/membership,
an explicit canonical property name, `--apply`, and
`--confirm FIRST_TENANT_BOOTSTRAP_V1`:

```powershell
node scripts/legacy-tg-first-tenant-bootstrap.mjs `
  --apply --confirm FIRST_TENANT_BOOTSTRAP_V1 `
  --account-id '<persisted auth-created account UUID>' `
  --user-id '<operator user UUID>' --role owner `
  --property-id '<canonical property UUID>' --property-name '<property name>' `
  --property-status active `
  --legacy-property-id 'test-prop-tg-live' `
  --reservation-id '<exact legacy reservation identity>'
```

Apply mode uses one transaction, creates only the missing canonical property
and legacy binding, and verifies `READY` before commit. It never creates users,
accounts, memberships, or password hashes. Re-running the same exact values is
idempotent. An unknown user, missing auth-created account/membership,
missing/ambiguous legacy evidence, or a conflicting account, membership,
property, or binding rolls the transaction back. It never changes or deletes
`tg_property_knowledge`, `tg_guest_reservations`, or email communication rows.

## Session correlation acceptance

Before deploying PR #235, inspect `GET /api/auth/session` read-only and require:

- `user.id` exists;
- `isCrmOperator === true`;
- `user.id` is the same `public.users.id` persisted in `account_members`;
- `account.id` is the same persisted account selected for the legacy property
  binding.

A session user UUID absent from `public.users` is an orphaned/stale session. It
blocks rollout and requires a future owner-approved normal authentication flow;
the bootstrap must not repair or trust it.

## Required rollout order

0. If the canonical user/session is missing, establish it through the normal
   ASI authentication flow described above. This is a future owner-approved
   production action.
1. Verify `GET /api/auth/session`: `user.id` exists, `isCrmOperator` is true,
   and its user/account IDs match the persisted membership selected for this
   rollout.
2. Inspect and reuse the exact canonical `accounts` and `account_members` rows
   created by authentication. Conflicting supplied IDs fail closed.
3. Apply the reviewed
   `20260821191132_legacy_tg_property_tenant_binding_v1.sql` migration. It first
   creates the non-partial unique index on `properties(account_id, id)` required
   by PostgreSQL, then creates the composite same-account FK.
4. Create the explicitly selected canonical `properties` row representing
   `test-prop-tg-live` in that same account.
5. Insert the `legacy_tg_property_bindings` row from `test-prop-tg-live` to that
   canonical account/property pair.
6. Run the tool in read-only mode and require every check to pass with
   `deployment_readiness: READY`.
7. Only then deploy the reviewed PR #235 application commit.
8. Run operator access acceptance: same-account GET/actions allowed; missing
   membership, missing binding, ambiguity, and cross-account access return `403`;
   unauthorized `send_reply` produces no provider call or mutation.
9. Run the accepted email scenario: recognized guest/reservation,
   `test-prop-tg-live`, manual mode, checkout `12:00`, grounded draft containing
   `12:00`, `draft_only`, and zero automatic outbound email.

Applying the migration before authentication is technically harmless because
it creates schema only, but the operational path must not assume canonical rows
exist. Deploying application code before steps 0–6 is technically safe because
access fails closed, but it is **SAFE BUT OPERATIONALLY BLOCKING**: the operator
UI is locked until the canonical layer and trusted binding are complete. It is
not the recommended order.

Existing legacy communication rows require a binding only when their text
property ids are used by operator-review communication paths. Unbound rows
intentionally remain hidden and all operator mutations remain forbidden. The
bootstrap preserves existing Telegram knowledge/reservations and email data;
none is rewritten merely to establish the canonical tenant.

## Rollback

Roll back application code first. The bridge table can remain unused without
affecting legacy communication data. After confirming no deployed code reads it,
drop `public.legacy_tg_property_bindings` in a separately approved production
migration. Dropping the bridge does not delete `tg_property_knowledge`,
`tg_guest_reservations`, `properties`, or `accounts` rows.
