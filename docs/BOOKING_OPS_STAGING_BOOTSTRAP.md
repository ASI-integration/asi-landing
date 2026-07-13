# Booking Ops staging bootstrap

## Architecture and repository audit

Staging is intentionally separate from production:

- domain: `staging.asi-global.ru`;
- application root: `/var/www/asi-staging` (`releases/`, `shared/`, and `current`);
- PM2 process: `asi-landing-staging`;
- loopback listener: `127.0.0.1:3001`;
- deployed branch/ref: latest `main` by default, or an explicitly selected commit/ref;
- GitHub environment: `staging`;
- database: a dedicated staging Supabase project, identified by its project reference.

Production currently deploys only by manual `workflow_dispatch` through `.github/workflows/deploy.yml`. It builds an artifact, deploys releases under `/var/www/asi`, switches `/var/www/asi/current`, and runs `asi-landing` with PM2 on `127.0.0.1:3000`. The repository production reverse proxy is `deploy/nginx/asi-global.ru.conf`. The staging workflow and deploy script do not call or modify those production paths or processes.

The application has dynamic JSON endpoints at `/api/health` and `/api/version`. The version response includes `environment`, exact release `sha`, and package `appVersion`. Static HTML or a mismatched staging identity fails deployment verification.

Booking Ops needs these runtime settings to be usable:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for server-side data access;
- `SESSION_SECRET` (at least 32 characters) for authenticated sessions;
- `ADMIN_SECRET` for administrative Booking Ops endpoints;
- `INTERNAL_TEST_SECRET` for the later internal smoke scenarios;
- dedicated inbound, auto-send runner, and alert runner secrets listed below.

The repository contains 80 ordered SQL files in `supabase/migrations`. A clean staging database therefore requires the committed migration history before Booking Ops smoke testing. Deployment does not apply migrations.

## Required GitHub `staging` environment secrets

Configure all values manually in the GitHub environment named `staging`. Never copy a production secret merely for convenience.

| Secret | Requirement |
| --- | --- |
| `STAGING_SSH_HOST` | Staging VPS hostname or IP |
| `STAGING_SSH_USER` | Dedicated staging deploy user |
| `STAGING_SSH_PRIVATE_KEY` | Private key authorized only for the staging deploy target |
| `STAGING_SSH_PORT` | Optional; defaults to `22` |
| `STAGING_APP_PATH` | Must be exactly `/var/www/asi-staging` |
| `STAGING_PORT` | Must be exactly `3001` |
| `STAGING_SUPABASE_PROJECT_REF` | Dedicated staging Supabase project reference (safe identifier logged) |
| `STAGING_SUPABASE_URL` | API URL for that same project |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging-only server key; never a browser/public value |
| `STAGING_DATABASE_URL` | Staging database connection string, used only to verify identity and for owner-approved migrations |
| `STAGING_SESSION_SECRET` | New staging-only random value, at least 32 characters |
| `STAGING_ADMIN_SECRET` | New staging-only admin API secret |
| `STAGING_INTERNAL_TEST_SECRET` | New staging-only smoke-route secret |
| `STAGING_BOOKING_OPS_INBOUND_INTAKE_SECRET` | New staging-only intake secret |
| `STAGING_BOOKING_OPS_AUTO_SEND_RUNNER_SECRET` | New staging-only runner secret; outbound remains disabled |
| `STAGING_BOOKING_OPS_ALERT_RUNNER_SECRET` | New staging-only alert runner secret |

No Telegram, email, payment, WhatsApp, phone, or other real provider credential is required. The generated runtime environment explicitly disables email auto-send, enables email draft-only behavior, forces Telegram outbound dry-run, and disallows real synthetic Telegram sends.

## Database isolation and migrations

The workflow stops before SSH unless all three database identity values exist and both URLs match `STAGING_SUPABASE_PROJECT_REF`. It logs only that project reference. There is no production fallback and no full URL is printed.

After creating the dedicated staging Supabase project, review its Postgres version and extensions, then apply the committed migration history from a trusted operator workstation only after explicit approval. Discover the installed CLI syntax first:

```bash
npx supabase --help
npx supabase migration --help
npx supabase db --help
```

The expected affected environment is only the Supabase project identified by `STAGING_SUPABASE_PROJECT_REF`. With `STAGING_DATABASE_URL` exported locally and verified, the repository's current direct migration command is:

```bash
npx supabase db push --db-url "$STAGING_DATABASE_URL" --include-all --dry-run
npx supabase db push --db-url "$STAGING_DATABASE_URL" --include-all
```

Stop after the dry run and obtain explicit approval before the second command. Do not run either command against an unidentified project. New Supabase projects may not expose new tables through the Data API automatically; after migration, verify the project's Data API exposure and RLS/grants before smoke testing.

## Manual DNS and server preparation

Create one DNS `A` record manually:

```text
staging.asi-global.ru -> <STAGING_VPS_PUBLIC_IPV4>
```

Use a short TTL during bootstrap. Do not change the production apex or `www` records.

On the authorized staging VPS, run these commands manually. They prepare only the staging directories and nginx site:

```bash
sudo install -d -o <STAGING_SSH_USER> -g <STAGING_SSH_USER> -m 750 /var/www/asi-staging
sudo install -d -o <STAGING_SSH_USER> -g <STAGING_SSH_USER> -m 700 /var/www/asi-staging/shared
sudo cp deploy/nginx/staging.asi-global.ru.conf /etc/nginx/sites-available/staging.asi-global.ru
sudo ln -sfn /etc/nginx/sites-available/staging.asi-global.ru /etc/nginx/sites-enabled/staging.asi-global.ru
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d staging.asi-global.ru
sudo nginx -t
sudo systemctl reload nginx
```

Rollback only the staging site configuration:

```bash
sudo rm /etc/nginx/sites-enabled/staging.asi-global.ru
sudo nginx -t
sudo systemctl reload nginx
```

Before running the deployment workflow, confirm DNS resolution, the dedicated database identity, server ownership, Node.js 20, PM2, nginx, and certificate issuance. After deployment, both URLs must return HTTP 200 with `Content-Type: application/json`:

```text
https://staging.asi-global.ru/api/health
https://staging.asi-global.ru/api/version
```

Do not run Booking Ops smoke scenarios until those checks succeed and `/api/version` reports `environment: "staging"` with the intended commit SHA.
