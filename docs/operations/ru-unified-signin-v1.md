# ASI RU — unified sign-in, implementation handoff (source-only)

## Goal and scope
All Russian-market ASI applications **that already share this repository's custom
`public.users`, `account_members`, `iron-session` cookie, and host** use the
same sign-in. The sign-in method must never change product entitlements or
automatically start a free trial.

- **Primary when enabled:** email plus 8-digit single-use code (10 minutes).
- **Fallback:** existing email/password login stays functional while migration
  and independent acceptance are incomplete.
- **Optional, future:** Yandex ID OAuth 2.0 with code + state + PKCE, separate
  Yandex OAuth app registration, exact registered redirect URI and issuer/user-ID
  binding. NEVER grant user access based only on an unverified provider email.
- **Optional, current:** Google sign-in remains available on environments where
  its JavaScript origin is registered; not a dependency for Russian users.
- **Owner/CRM/GPS:** existing session and owner allowlists unchanged. Owners
  created through Google-only sign-in can use the same verified email address,
  with no new account or trial.

Independent Russian products on other domains or identity stores require
explicit OIDC/session federation and migration plans, **not cookie sharing across
unrelated domains**. Do not claim cross-product SSO until individually integrated.

## Source implementation
- `src/lib/auth/ru-email-code-policy.ts` — eight-digit random generation,
  server-peppered per-email HMAC, same-origin POST validation and
  fail-closed provider configuration.
- `src/lib/auth/ru-email-code-server.ts` — issue/consume atomic RPCs,
  per-IP and per-email limits, dedicated Resend transactional delivery.
- `src/app/api/auth/email-code/request/route.ts` and
  `src/app/api/auth/email-code/verify/route.ts` — RU-only POST.
- `src/app/api/auth/ru-methods/route.ts` — truthful method availability.
- `src/components/auth/RuEmailCodeSignIn.tsx` — reusable client UI
  on `/login` and RU `/ru/connect`.
- `docs/operations/ru-email-code-auth-sql-draft.sql` — **not a migration**
  and **not applied**. Implement as a numbered reviewed migration
  with `supabase migration new` only after staging approval.

The sender is for user sign-in only. Guest/email auto-send and communication
kill-switches remain independent and unchanged. No OTP is logged. Never
expose the Resend key or pepper through `NEXT_PUBLIC_*`.

## Deployment prerequisites (all mandatory)
1. Protected review of database SQL. Generate real migration via Supabase CLI,
   test with disposable/staging database, check RLS/GRANT and RPC access as
   `anon`, `authenticated`, and `service_role`. Restrict functions to
   `service_role`, no public execution. Verify 60-second email cooldown,
   5/email/hour, 20/IP/hour, 5 failures, 10-minute expiry, consumption and
   replay, simultaneous requests, crashed/failed SMTP behavior.
2. Only after the isolated database has passed the real RPC/RLS and concurrency
   acceptance, set protected `ASI_RU_EMAIL_CODE_SCHEMA_READY=true` on the exact
   reviewed RU target. This defaults OFF: possessing mail credentials alone
   must not advertise a working code-login button or admit OTP requests.
   Configure the exact server-only `ASI_RU_EMAIL_CODE_ORIGIN=https://www.asi-global.ru`
   (only when that is the independently verified RU host); never trust generic
   `.ru` or client-controlled forwarded-host values for OTP routing. Configure
   server-only `ASI_RU_EMAIL_CODE_ENABLED=true`,
   `ASI_RU_EMAIL_CODE_PEPPER` (>=32 random characters, independent of
   `SESSION_SECRET`), `ASI_AUTH_RESEND_API_KEY` and
   `ASI_AUTH_FROM_EMAIL` on the exact RU deployment target.
   Verify sending domain and SPF/DKIM/DMARC. A missing setting leaves the
   feature unavailable. `ASI_RU_AUTH_TRUST_PROXY` may be true **only**
   if a trusted edge overwrites untrusted forwarded-IP headers; otherwise
   all requests use a conservative shared IP quota.
3. Real email delivery test with a dedicated test mailbox and exact checked
   session/account mapping. The request endpoint returns the same generic
   success for registered/unregistered addresses. Provider delivery failure
   is a controlled 503, not a misleading success.
4. Exact-head CI, code review, safe staging acceptance and an independently
   approved protected release. No bypass of governance, database migrations,
   user-account linking, production secrets or protected deploy gates.
5. After release verify `/api/auth/session`, owner GPS and CRM permissions,
   old password login, Google fallback, non-owner denial and no new trial
   for existing users. Verify on HTTPS through the real RU host.

## Yandex ID follow-up
Yandex OAuth documentation: https://yandex.ru/dev/id/doc/ru/codes/code-url
and https://yandex.ru/dev/id/doc/ru/codes/code-and-token . Register the app,
choose exact redirect URLs and minimal scope, use server-side token exchange
and state/PKCE, read verified subject `id` from Yandex ID, link explicitly to
the existing ASI user, then enable UI. `yandexId=false` until completed.
Do not invent credentials or expose a working-looking unauthenticated button.

## Release status
**SOURCE_PREPARED only**. No schema changes applied, no production mail,
no Yandex app registered, no site/secret modifications and no protected merge.
P0 standing authority work (#551/#552) is separate and must not be interrupted.


## Yandex ID implementation and owner-required registration

Source code now includes disabled exact-origin OAuth 2.0 flow:
- `src/lib/auth/ru-yandex-policy.ts`: 32-byte state, S256 PKCE, signed session
  transient state, 10-minute expiry and canonical RU origin restriction.
- `src/app/api/auth/yandex/start/route.ts`: login/link initiation. A link
  requires a recent password/email-code proof **bound to the same ASI
  user ID**. Older sessions without that identity-bound proof fail closed.
  A Yandex re-login cannot inherit stale strong-proof flags from another user.
- `src/app/api/auth/yandex/callback/route.ts`: one-time state invalidation
  before server-only code exchange; fetch subject `id` from Yandex with an
  Authorization header, never URL query; require the returned Yandex
  `client_id` to match our registered OAuth app and a positive canonical
  numeric `id`; link only by persistent subject. No auto-link by email.
- `src/app/dashboard/settings/page.tsx`: link button only when configured.
- `src/lib/auth/__tests__/ru-yandex-policy.test.ts`: pure negative tests.
- Draft table `ru_auth_yandex_links`: RLS-enabled, service-role-only, one
  Yandex subject per ASI user, no anonymous endpoint or direct grants.

The app itself must be registered with the authorized ASI/Yandex operator:
https://oauth.yandex.ru/client/new (registration interaction required; do NOT
paste client_secret in a PR, chat, log, or public config).
Choose **user authentication**, **Web services**, minimal scope
`login:info` and the exact registered callback
`https://www.asi-global.ru/api/auth/yandex/callback`
(only if `www` is the production RU host; do not swap with Beget/G2/preview).
After verified ownership, operator places server-only
`ASI_RU_YANDEX_CLIENT_ID`, `ASI_RU_YANDEX_CLIENT_SECRET`,
`ASI_RU_YANDEX_ORIGIN=https://www.asi-global.ru` in the actual RU host.
The capability guard also requires the existing **server-only**
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` (or legacy
`NEXT_PUBLIC_SUPABASE_URL`) for the same approved ASI identity project.
Missing database connection settings must not make Yandex appear operational;
this check does not grant permission to migrate either existing project.
Leave `ASI_RU_YANDEX_ID_ENABLED=false` and
`ASI_RU_YANDEX_LINKS_READY=false` until the protected migration,
full OAuth callback acceptance, redirect-origin check and user linking are
independently verified. The UI has no functional button until both flags true.

**Security:** Never infer owner entitlement from Yandex email. The initial
Yandex login for an unlinked subject returns `link_first`. Authenticate the
existing user with a confirmed email-code or valid password, then link
from account settings after fresh login. Prevent link if the subject is already
owned by another user, and never create another ASI account silently.
Provider and ASI data-sharing consent/privacy notices require release review.

## Verified environment reconnaissance (2026-10-29)
- The current connected Supabase integration enumerates only
  `meeravcldnmocjtlqoeu`, whereas the ASI owner confirms **two**
  existing Supabase projects (the other is `jwinifeienvzejofmbua`).
  The connector listing is not evidence that the second project is absent.
  Read-only metadata verified `public.users.id` is UUID and
  `password_hash` remains NOT NULL in the accessible project; none of
  the proposed RU-auth tables existed there on 2026-10-29.
  **Neither project is approved as a disposable staging database.**
  NO migration, tests with real credentials, or user writes were made.
- Vercel project metadata reveals no `ASI_RU_EMAIL_CODE_PEPPER`,
  `ASI_AUTH_RESEND_API_KEY`, `ASI_AUTH_FROM_EMAIL` or Yandex OAuth env
  keys; existing variable VALUES were not accessed.
- Live domain/target and sender ownership must be independently confirmed.
  Existing runtime route evidence does not prove DNS health or operator access.
- On current branch code is SOURCE_PREPARED only. All production/host/secret/
  migration/real-send operations remain untouched until exact target,
  independently validated rollout, pre-approved protected action and
  rollback are available. A preview build cannot replace a live sign-in test.

## Acceptance checklist to unblock a controlled rollout
1. Install named migration in an **isolated staging database first**, using
   an installed and version-checked Supabase CLI with `migration new`; do
   not run the draft SQL directly against connected production. Capture
   migration SHA/rollback plan, service_role/anon/authenticated grants, and
   concurrent issuance/consume/expired/replay tests.
2. Register/verify sending domain with SPF, DKIM and DMARC; configure the
   transactional mail sender using protected environment variables only.
   Test one consented dedicated mailbox, no bulk or guest messages.
3. Verify persistent existing user identity and the existing iron-session,
   old password login, owner GPS permissions, nonowner denial, no new trial,
   five failed attempts and full code expiry/replay.
4. Register and configure Yandex application; verify fresh password/code
   step-up, link, re-login by subject, bad state, callback mismatch, expired
   flow, subject conflicts, CSRF replay and revocation behavior.
5. Independent exact-head CI and protected release, verify deployed source
   SHA and rollback. Preserve existing account and messaging safety rules.

## Source security checkpoint — 2026-10-29
- The identity-bound `lastStrongAuthUserId` is recorded only by successful
  password/email-code routes and compared at both Yandex-link start and callback.
  This prevents a fresh step-up from user A being reused after switching the
  browser session to user B through another provider.
- The Yandex profile `client_id` is checked against the exact configured
  application ID in addition to the OAuth code exchange and PKCE checks.
  Numeric zero/leading-zero subjects are rejected consistently in code and
  proposed SQL. A user must first explicitly link an existing ASI account;
  unlinked sign-in now returns a concrete guidance message, not a fake success.
- Documentation: https://yandex.ru/dev/id/doc/ru/user-information
  lists `client_id`, `id`, and `psuid` in the Yandex identity response.
- These are **source-only defenses**, not evidence of a configured Yandex
  application, independent DB tests, verified sender, deployed authentication,
  or protected release. The original two Supabase projects and Beget PostgreSQL
  remain separate; no migration, DB schema, secret or production host changed.

## Additional Yandex server-side protocol review — 29 October 2026
- Official code redirect reference:
  https://yandex.ru/dev/id/doc/ru/codes/code-url specifies `response_type=code`,
  exact **Web services / Redirect URI**, `state`, S256 PKCE and ten-minute
  code validity. The documented token POST accepts `grant_type`, `code`,
  client credentials and `code_verifier`; the previously sent undocumented
  `redirect_uri` token POST parameter has been removed.
- Official profile reference: https://yandex.ru/dev/id/doc/ru/user-information
  documents both `client_id` and `id`, which are checked as our trusted
  application and the stable provider subject. ASI access is not email-matched.
- Account-link GET initiation now rejects `Sec-Fetch-Site` values `cross-site`,
  `same-site` and `none`; legacy browsers need an exact same-origin
  `Referer`. The normal login redirect flow is unaffected.
- Server-side redirect flow requires the Yandex app's exact **Web services
  Redirect URI**; JavaScript origins are only required if a separate browser
  widget is later used or the app admin requires them. Do not present the
  existing disabled button as a working login.
- SQL draft previously had a truncated CHECK plus duplicate orphan table
  fragment. Both were repaired; this file remains design-only SQL that still
  requires isolated PostgreSQL, RLS and race verification before migration.
- No Yandex application, domain, DNS, credentials, sender, database or
  production release was modified in this checkpoint.

## OTP pending activation and token response hardening — 29 October 2026

- The SQL remains a **source-only draft**. The issue RPC now persists an
  **inactive** pending challenge; delivered_at stays NULL and the consume RPC
  rejects it. The separate activate RPC can make only that exact hash usable,
  in a DB transaction and only after the dedicated mail provider accepted the
  request. The service checks a true RPC result; errors or timeouts do not count
  as successful delivery. Failures attempt exact-hash revocation, preserving the
  hour quotas. This closes the prior window when a newly issued hash was valid
  before mail confirmation.
- Operational caveat: a mail-provider acknowledgement, a database commit and the
  application's receipt cannot form one distributed atomic transaction. If an
  activation commits but its reply is lost and subsequent revocation fails, the
  result is **UNKNOWN**, not a proven revoked code. Keep email login disabled
  until disposable-DB fault injection has exercised this path and the controlled
  release has an incident/expiry response. The pending-by-default path prevents
  credentials from activating merely because issuance or delivery failed.
- The Yandex token response is now checked for the officially documented
  token_type=bearer; unknown types, control characters, missing tokens and
  oversized access tokens fail closed before sending an Authorization header.
  References: https://yandex.ru/dev/id/doc/ru/codes/code-url and
  https://yandex.ru/dev/id/doc/ru/user-information .
- Focused mock regression tests were **added**, including request/delivery/
  activation ordering and negative failure paths. Auth source has not passed
  standalone repository TypeScript, Vitest, isolated SQL concurrency, provider
  acceptance or owner login yet. A Vercel preview build alone is not acceptance.
- No schema was applied to either of the owner's TWO Supabase projects or to
  Beget PostgreSQL. No sender or OAuth application was administered, and no
  real mail was sent during this source change.

## Case-insensitive identity preflight (source-only)

The existing public.users unique(email) enforces raw case-sensitive spelling,
while RU OTP normalizes incoming mailboxes. A new verified login must reuse a
unique case-fold-equivalent existing user; collisions and unexpected ILIKE
pattern matches must fail closed, not manufacture a second identity or silently
assign owner privileges. The current source queries with escaped ILIKE literals,
then verifies exact case-folded matches before issuing a session. This is NOT
a substitute for a database-level invariant: require a reviewed audit of
lower(email) duplicates and an appropriate case-insensitive unique index (or
equivalent guaranteed invariant) in explicitly isolated staging before
enabling new-user creation at scale. No live index/user modification is approved.
