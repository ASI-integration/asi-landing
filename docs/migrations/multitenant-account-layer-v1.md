# Multitenant account/workspace layer v1

This repo already has an existing `public.users` table and related auth/session/subscription logic (see `supabase/migrations/001_initial_schema.sql`).  
To avoid breaking current environments and to avoid table-name conflicts, the multitenant layer is introduced **without creating a new `users` table**.

## What’s new in v1

- **`accounts`**: the workspace/customer boundary (billing + plan live here).
- **`account_members`**: links existing app users (`public.users`) to accounts with a role.
- **`properties`, `channels`, `conversations`, `message_turns`**: operational/communication data, all owned by `account_id`.

## Why `account_members` instead of a new `users` table

The original draft schema included a new `users` table. This repo already has `public.users`, so introducing another `users` table would:

- conflict at migration-time (same table name), and/or
- introduce ambiguity about which “user” table the application should use.

`account_members` preserves the current user model and adds the minimal join layer needed for multitenancy.

## How existing users link to accounts

- `account_members.user_id` references **`public.users(id)`**.
- `account_members.account_id` references `accounts(id)`.
- `account_members.role` is constrained to: `owner`, `manager`, `operator`.
- A user can belong to multiple accounts, and each membership is unique via `UNIQUE (account_id, user_id)`.

In other words:

- **Authentication / identity** stays where it is today (`public.users`, `sessions`, etc.).
- **Tenancy / workspace membership** is expressed via `account_members`.

## Subscription + onboarding expectations (v1)

This migration intentionally keeps billing simple: it only makes the `accounts` table ready for onboarding + trial.

### 7-day trial flow

Expected v1 behavior (implemented at application level):

- When an account is created, it can start with:
  - `subscription_status = 'trial'` (default)
  - `plan_code = 'small'` (default)
- On trial start, set:
  - `trial_started_at = now()`
  - `trial_ends_at = trial_started_at + interval '7 days'`

### Plan selection

When the user selects a plan during onboarding, update:

- `accounts.plan_code` to one of `small`, `growth`, `enterprise`.

### Subscription status lifecycle

`accounts.subscription_status` is expected to move between:

- `trial` → `active` → (`paused` | `canceled`)

### What is intentionally NOT implemented yet

Not included in v1 (by design):

- provider webhooks / billing event tables
- invoices, payments, retries
- advanced subscription lifecycle and proration logic

Those can be added later in incremental migrations once a payment provider is integrated.

