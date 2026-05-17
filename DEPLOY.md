# DEPLOY RUNBOOK — asi-landing

## PRE-DEPLOY CHECKLIST
- [ ] локальный билд чистый: `npm run build` без ошибок
- [ ] все изменения закоммичены и запушены в `main`
- [ ] нет незавершённых агентов или параллельных деплоев

---

## 1. ЛОКАЛЬНЫЙ COMMIT/PUSH

```bash
git add -p                     # проверить что коммитишь
git commit -m "feat/fix: ..."
git push origin main
```

---

## 2. СЕРВЕРНЫЙ DEPLOY

```bash
ssh root@<server>
# Canonical production deploy: push to `main` → GitHub Actions builds the artifact and runs
# `scripts/deploy-artifact.sh` on the VPS. Do not run `deploy.sh` (retired).
#
# See: `.github/workflows/deploy.yml` + `scripts/deploy-artifact.sh`
```

`deploy.sh` is **retired** (it exits with an error if invoked).

**Current discipline (prod)**:

- build happens in GitHub Actions (lint + typecheck + tests + `next build`)
- VPS receives `/tmp/asi-release-<sha>.tgz`
- VPS runs `scripts/deploy-artifact.sh <sha> /tmp/asi-release-<sha>.tgz`
- no `next build` on the VPS in the normal production flow

**Успех** — в логе GitHub Actions job `deploy` зелёный; на сервере `pm2 status` и `curl http://127.0.0.1:3000/api/version`.

---

## 3. ROLLBACK

```bash
# symlink rollback to an existing unpacked release (no rebuild)
ASI_BASE_DIR=/var/www/asi bash scripts/rollback-artifact.sh <full-sha>

# list available release dirs
ls /var/www/asi/releases
```

`rollback.sh` is **retired** (it exits with an error if invoked).

---

## 4. ПРОВЕРИТЬ ПОСЛЕ ДЕПЛОЯ

```bash
curl -I http://127.0.0.1:3000          # HTTP 2xx/3xx = OK
pm2 status                             # asi-landing online, 0 restarts
pm2 logs asi-landing --lines 20        # нет FATAL/unhandled
```

В браузере: открыть главную + RU-страницу + проверить локаль.

### Location report PDF (Playwright / Chromium)

Платный PDF (`GET /api/location-report/[reportId]/pdf`) рендерится через **playwright-core** и системный Chromium. На VPS браузер Playwright **не** скачивается автоматически — его нужно установить один раз на сервере.

**Установка Chromium (Debian/Ubuntu, Timeweb VPS):**

```bash
apt-get update
apt-get install -y chromium
# путь обычно /usr/bin/chromium или /usr/bin/chromium-browser
which chromium || which chromium-browser
```

Если бинарник не в стандартных путях, задайте в `shared/.env.production.live`:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
```

**Базовый URL для print-страницы** (Next.js открывает её локально при генерации PDF):

```bash
LOCATION_REPORT_PDF_BASE_URL=https://asi-global.ru
```

Порядок fallback в коде: `LOCATION_REPORT_PDF_BASE_URL` → `NEXT_PUBLIC_APP_URL` → `NEXT_PUBLIC_URL`. Без явного URL в production используется `http://127.0.0.1:3000` — PDF часто падает; всегда задавайте `LOCATION_REPORT_PDF_BASE_URL` на проде.

**Проверка после деплоя (на сервере, из каталога релиза):**

```bash
cd /var/www/asi/current
set -a && source /var/www/asi/shared/.env.production.live && set +a
npx tsx scripts/check-location-pdf-chromium.ts
# ok: true и exit 0
```

При ошибке смотреть `pm2 logs asi-landing` — строки `[location-report-pdf]` с кодом (`chromium_missing`, `chromium_launch_failed`, …). Клиенту уходит короткое сообщение на русском без путей и stack trace.

---

## Working PM2 baseline

- **Deploy uses clean PM2 start (not reload)**: stop → kill port → delete → `pm2 start`
- **App start method**: direct `node` → `next` binary (not `npm run start`)
- **PM2 facts (known-good)**:
  - `pm_exec_path`: `/var/www/asi/current/node_modules/next/dist/bin/next`
  - `pm_cwd`: `/var/www/asi/current`
  - `exec_interpreter`: `node`
  - `restart_time`: `0` right after successful start
- **Version integrity**: `/api/version` SHA must match `release-meta.json` SHA

**Do not change casually**:
- do not switch back to `pm2 startOrReload` for this app
- do not switch back to `npm run start` without explicit reason
- if startup method changes again, treat it as a migration and use a fresh PM2 restart

---

## ЗАПРЕЩЕНО

- **Не делать `pm2 restart`** вручную — только через GitHub Actions deploy или `scripts/rollback-artifact.sh`
- **Не запускать `pm2 delete` / `pm2 kill`** в продакшне без rollback-плана
- **Не деплоить при failed build** — если build упал, чинить локально и пушить снова
- **Не запускать два деплоя параллельно** — один агент/сессия за раз
- **Не редактировать файлы напрямую на сервере** — только через git push + CI deploy
- **Не делать `git reset --hard` на сервере** вручную — использовать `scripts/rollback-artifact.sh`

---

## ЕСЛИ ДЕПЛОЙ ЗАВИС / УПАЛ

1. Проверить: `pm2 status` — процесс живой?
2. Если build упал → починить локально → push → deploy снова
3. Если healthcheck не прошёл → `scripts/rollback-artifact.sh` немедленно
4. Если nginx не стартует → `nginx -t` → смотреть конфиг ошибку
