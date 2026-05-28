# ASI Landing Staging Deploy

This runbook is for staging only. It does not replace the current production artifact deploy.

## Fixed Staging Targets

- Base directory: `/var/www/asi-staging`
- Current symlink: `/var/www/asi-staging/current`
- Releases: `/var/www/asi-staging/releases/<sha>`
- Shared env file: `/var/www/asi-staging/shared/.env.staging.live`
- PM2 process: `asi-landing-staging`
- Local app port: `3001`
- Health URL: `http://127.0.0.1:3001/api/health`
- Version URL: `http://127.0.0.1:3001/api/version`

Production targets must not be used by staging:

- `/var/www/asi`
- `/var/www/asi/current`
- `asi-landing`
- port `3000`
- `/var/www/asi/shared/.env.production.live`

## Required Environment Variables

Create `/var/www/asi-staging/shared/.env.staging.live` on the server before the first staging deploy. Do not commit secrets.

Required values depend on the feature being tested, but staging should have its own non-production values for:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_URL`
- `LOCATION_REPORT_PDF_BASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TWOGIS_CATALOG_API_KEY`
- `GOOGLE_MAPS_SERVER_API_KEY`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, if Chromium is not in a standard path

Use staging URLs that route to the staging app. For local server checks, the app listens on `127.0.0.1:3001`.

## Telegram Staging Bot

Staging must use a separate Telegram bot token. Do not point the production bot at staging.

The staging bot webhook must target the staging public URL only. Use the repository webhook helper with staging env loaded on the server, for example:

```bash
cd /var/www/asi-staging/current
set -a && source /var/www/asi-staging/shared/.env.staging.live && set +a
node scripts/set-ru-telegram-webhook.mjs
node scripts/tg-webhook-info.mjs
```

Check that the webhook URL belongs to the staging host and that the token is the staging bot token before sending any test messages.

## Manual Deploy

Build or download an artifact separately, copy it to the server, then run:

```bash
bash scripts/deploy-artifact-staging.sh <commit-sha> /tmp/asi-release-<commit-sha>.tgz
```

The script creates a staging-only PM2 config inside the release and starts only `asi-landing-staging` on port `3001`.

## Health Checks

On the server:

```bash
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS http://127.0.0.1:3001/api/version
pm2 status asi-landing-staging
pm2 logs asi-landing-staging --lines 50 --nostream
```

The `/api/version` SHA must match the staged artifact SHA.

## Rollback

List staged releases:

```bash
ls /var/www/asi-staging/releases
```

Roll back staging only:

```bash
bash scripts/rollback-artifact-staging.sh <existing-release-sha>
```

The rollback script only uses `/var/www/asi-staging`, `asi-landing-staging`, and port `3001`.

## Production Safety Checklist

Before running staging deploy or rollback:

- Confirm the script name includes `staging`.
- Confirm the base path is `/var/www/asi-staging`.
- Confirm the PM2 process is `asi-landing-staging`.
- Confirm the port is `3001`.
- Confirm the env file is `/var/www/asi-staging/shared/.env.staging.live`.
- Confirm no command references `/var/www/asi/current`.
- Confirm no command targets PM2 process `asi-landing`.
- Confirm no staging Telegram command uses the production bot token.
- Do not edit production nginx or production PM2 config.
- Do not deploy from a push to `main` when you only intend to stage changes.
