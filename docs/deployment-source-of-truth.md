# Deployment Source Of Truth

This document prevents mixing up local branches, GitHub PRs, Vercel previews, and Timeweb production.

## Canonical Rules

- `main` is the production source branch.
- Feature branches and PRs are not live production.
- Vercel is preview/check only for this project. A green Vercel preview does not mean production changed.
- Timeweb VPS is production hosting.
- Production deploys are artifact-based through GitHub Actions on `main`.
- Production runtime is the PM2 app `asi-landing` running from `/var/www/asi/current`.
- Production Telegram webhook must point to the Timeweb production URL, not localhost, ngrok, or Vercel.
- Local dev tests are not live Telegram tests unless the Telegram webhook is explicitly pointed to a local tunnel for a dedicated test bot.
- Live tests require: merge to `main`, deploy to Timeweb, verify deployed commit, verify Telegram webhook URL.

## Existing Deploy Flow

Current production deploy is defined by:

- `.github/workflows/deploy.yml`
- `scripts/deploy-artifact.sh`
- `DEPLOY.md`
- `docs/atomic-deploy.md`

Flow:

1. Push or merge to `main`.
2. GitHub Actions builds the exact commit.
3. CI runs lint, typecheck, selected tests, and `next build`.
4. CI creates `asi-release-<sha>.tgz` with `.next`, production `node_modules`, and `release-meta.json`.
5. CI copies the artifact to the Timeweb VPS.
6. VPS runs `scripts/deploy-artifact.sh <sha> /tmp/asi-release-<sha>.tgz`.
7. Deploy script unpacks to `/var/www/asi/releases/<sha>`.
8. Deploy script atomically switches `/var/www/asi/current`.
9. Deploy script clean-starts PM2 app `asi-landing`.
10. Deploy script verifies `/api/health` and `/api/version` match the artifact SHA.

Retired paths:

- `deploy.sh` is retired and exits with an error.
- `scripts/deploy-release.sh` is retired and exits with an error.
- Do not build in the live Timeweb tree during normal production deploy.

## What Is Live And What Is Not

| Place | Purpose | Is it production? |
| --- | --- | --- |
| Local branch | Development and local tests | No |
| Feature branch | Work in progress | No |
| GitHub PR | Review and CI | No |
| Vercel preview | Preview/check only | No |
| GitHub `main` after merge | Production source branch | Source only, not live until deployed |
| Timeweb PM2 app | Production runtime | Yes |

## Required Live-Test Sequence

Do not test live behavior until all of these are true:

- [ ] PR is merged to `main`.
- [ ] Local `main` is pulled or `origin/main` is fetched.
- [ ] GitHub Actions deploy job for `main` is green.
- [ ] Timeweb deploy completed for the expected commit SHA.
- [ ] PM2 app `asi-landing` was restarted/recreated by deploy.
- [ ] `/api/health` passes on Timeweb.
- [ ] `/api/version` SHA matches GitHub `main`.
- [ ] Telegram webhook points to the Timeweb production domain.
- [ ] Required production env vars are present on Timeweb.
- [ ] PM2 logs are visible.

## Verification Commands

Run local commands from repo root.

### Current local branch and commit

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
```

### Current GitHub main latest commit

Use either local remote state:

```bash
git fetch origin main
git rev-parse origin/main
```

Or ask GitHub directly:

```bash
git ls-remote origin refs/heads/main
```

The first SHA printed by `git ls-remote` is the latest GitHub `main` commit.

### Timeweb deployed commit/version

Public route check, if the production domain is reachable:

```bash
curl -fsS https://asi-global.ru/api/version
curl -fsS https://asi-global.ru/api/health
```

Server-side check over SSH:

```bash
ssh <timeweb-user>@<timeweb-host> 'curl -fsS http://127.0.0.1:3000/api/version && echo'
ssh <timeweb-user>@<timeweb-host> 'curl -fsS http://127.0.0.1:3000/api/health && echo'
ssh <timeweb-user>@<timeweb-host> 'cat /var/www/asi/current/release-meta.json'
ssh <timeweb-user>@<timeweb-host> 'readlink -f /var/www/asi/current'
```

Expected:

- `/api/version.sha` equals `origin/main`.
- `/var/www/asi/current/release-meta.json.gitSha` equals `origin/main`.
- `/api/version.releasePath` points to `/var/www/asi/releases/<same-sha>`.

### PM2 app status

```bash
ssh <timeweb-user>@<timeweb-host> 'pm2 status asi-landing'
ssh <timeweb-user>@<timeweb-host> 'pm2 describe asi-landing'
ssh <timeweb-user>@<timeweb-host> 'pm2 logs asi-landing --lines 80 --nostream'
```

More exact runtime fingerprint:

```bash
ssh <timeweb-user>@<timeweb-host> 'node -e '"'"'
const { execSync } = require("child_process");
const list = JSON.parse(execSync("pm2 jlist").toString("utf8"));
const p = list.find(x => x && x.name === "asi-landing");
const env = p && p.pm2_env || {};
console.log(JSON.stringify({
  name: p && p.name,
  status: env.status,
  pid: env.pid,
  restart_time: env.restart_time,
  pm_cwd: env.pm_cwd,
  pm_exec_path: env.pm_exec_path,
  exec_interpreter: env.exec_interpreter
}, null, 2));
'"'"''
```

Expected known-good baseline:

- `status` is `online`.
- `restart_time` is `0` immediately after a successful deploy.
- `pm_cwd` is `/var/www/asi/current`.
- `pm_exec_path` is `/var/www/asi/current/node_modules/next/dist/bin/next`.
- `exec_interpreter` is `node`.

### Server route health check

From the Timeweb server:

```bash
ssh <timeweb-user>@<timeweb-host> 'curl -i http://127.0.0.1:3000/api/health'
ssh <timeweb-user>@<timeweb-host> 'curl -i http://127.0.0.1:3000/api/version'
```

From outside:

```bash
curl -i https://asi-global.ru/api/health
curl -i https://asi-global.ru/api/version
```

Expected:

- HTTP 200.
- `Cache-Control` prevents stale cache.
- JSON contains the expected SHA.

### Telegram webhook info

Production admin route helper:

```bash
node scripts/check-ru-telegram-webhook.mjs
```

Direct Telegram helper using `.env.ru` token:

```bash
node scripts/tg-webhook-info.mjs
```

Direct Telegram API:

```bash
curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Expected:

- `ok` is `true`.
- `url` is the Timeweb production URL.
- `url` contains the production domain, for example `asi-global.ru`.
- `url` ends with `/api/telegram/webhook`.
- `url` does not contain `localhost`, `127.0.0.1`, `ngrok`, `vercel.app`, or any Vercel preview domain.

Quick URL guard:

```bash
node scripts/tg-webhook-info.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const u=String(j.webhook_url||'');console.log(u);process.exit(u.includes('asi-global.ru') && u.endsWith('/api/telegram/webhook') ? 0 : 1);})"
```

### Env vars present on Timeweb

Do not print secret values. Check only key presence:

```bash
ssh <timeweb-user>@<timeweb-host> 'set -a; . /var/www/asi/shared/.env.production.live 2>/dev/null; for k in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY LLM_API_KEY OPENAI_API_KEY; do if [ -n "${!k:-}" ]; then echo "$k=present"; else echo "$k=missing"; fi; done'
```

Adjust the env list to the feature being tested.

## Telegram Webhook Source Of Truth

Production Telegram behavior depends on the Timeweb runtime:

- Runtime env `TELEGRAM_BOT_TOKEN`.
- Runtime route `POST /api/telegram/webhook`.
- Runtime code deployed under `/var/www/asi/current`.
- Telegram Bot API webhook URL.

Changing local `.env` files does not change production.

Changing a Vercel preview does not change production.

Changing a feature branch does not change production.

For production Telegram live tests, verify all three match:

```text
origin/main SHA == Timeweb /api/version.sha == /var/www/asi/current/release-meta.json gitSha
```

Then verify:

```text
Telegram getWebhookInfo.url == https://asi-global.ru/api/telegram/webhook
```

## Local Telegram Tests

Local tests are not live unless a Telegram bot webhook points to the local tunnel.

Local-only route test:

```bash
npm run dev
curl -i http://127.0.0.1:3000/api/health
```

Local tunnel test with a dedicated test bot:

```bash
ngrok http 3000
curl -X POST "https://api.telegram.org/bot${TELEGRAM_TEST_BOT_TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url":"https://<ngrok-host>/api/telegram/webhook","allowed_updates":["message","edited_message"]}'
```

Never point the production bot webhook at localhost, ngrok, or Vercel.

## Failure Diagnosis

### Bot silent

Check in order:

1. `getWebhookInfo.url` points to Timeweb production domain.
2. `getWebhookInfo.last_error_message` is empty.
3. Timeweb `/api/health` returns 200.
4. Timeweb `/api/version.sha` matches `origin/main`.
5. `pm2 status asi-landing` is online.
6. `pm2 logs asi-landing --lines 120 --nostream` shows webhook receipt logs.
7. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are present in Timeweb env.

### Vercel green but Timeweb unchanged

Vercel is not production. Check GitHub Actions deploy job for `main`, then Timeweb `/api/version`.

Commands:

```bash
git ls-remote origin refs/heads/main
curl -fsS https://asi-global.ru/api/version
```

If SHAs differ, Timeweb is still running an older release.

### Local server works but Telegram bot does not

Local `npm run dev` only proves local code. It does not prove Telegram production.

Check:

```bash
node scripts/tg-webhook-info.mjs
curl -fsS https://asi-global.ru/api/version
ssh <timeweb-user>@<timeweb-host> 'pm2 logs asi-landing --lines 120 --nostream'
```

If the webhook URL is Timeweb, local changes are irrelevant until merged and deployed.

### PR checks pass but production old

PR checks are not deployment. Merge the PR to `main`, wait for GitHub Actions deploy, then verify Timeweb SHA.

```bash
git fetch origin main
git rev-parse origin/main
curl -fsS https://asi-global.ru/api/version
```

### Changes visible locally but not live

Check:

1. Are you on a feature branch?
2. Was it merged to `main`?
3. Did GitHub Actions deploy run?
4. Does `/api/version.sha` match `origin/main`?
5. Does Telegram webhook point to Timeweb?

If any answer is no, the change is not live.

## Do Not Test Live Until

- [ ] The PR is merged.
- [ ] `origin/main` contains the target commit.
- [ ] The GitHub Actions deploy job completed successfully.
- [ ] Timeweb `/api/version.sha` equals the target commit.
- [ ] PM2 app `asi-landing` is online.
- [ ] PM2 runtime points to `/var/www/asi/current`.
- [ ] Health check passes.
- [ ] Telegram webhook points to the Timeweb production URL.
- [ ] Required env vars are present on Timeweb.
- [ ] Logs are visible and tailing cleanly.

## Missing Values To Fill In

The repo docs do not currently state the exact Timeweb SSH target. Fill these in in your private runbook or password manager:

```text
timeweb-user=
timeweb-host=
timeweb-ssh-port=
production-domain=asi-global.ru
pm2-app=asi-landing
base-dir=/var/www/asi
```

Do not commit private hostnames, IPs, SSH keys, or secrets unless they are intentionally public operational metadata.
