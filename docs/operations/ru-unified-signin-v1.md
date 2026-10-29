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
2. Configure server-only `ASI_RU_EMAIL_CODE_ENABLED=true`,
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
  requires an existing ASI session with fresh password or email-code proof.
- `src/app/api/auth/yandex/callback/route.ts`: one-time state invalidation
  before server-only code exchange; fetch subject `id` from Yandex with an
  Authorization header, never URL query; link only by persistent Yandex
  numeric subject. No automatic link by provider email.
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
- Connected Supabase provides **one active ASI project**. Read-only catalog
  query confirmed none of the three proposed auth tables yet exist.
  This may be live/shared data; NO production DDL is authorized by a Draft PR
  or by exploratory verification.
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
