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
cd /root/asi-landing
bash deploy.sh
```

Скрипт делает: `git pull` → `npm install` → `npm run build` →
`pm2 reload` → healthcheck → `nginx reload`.

**Успех** — последняя строка `[deploy] success`.

---

## 3. ROLLBACK

```bash
# откат на предыдущий коммит
bash rollback.sh

# откат на конкретный SHA
bash rollback.sh <sha>
```

Перед откатом: `git log --oneline -6` чтобы выбрать нужный SHA.

---

## 4. ПРОВЕРИТЬ ПОСЛЕ ДЕПЛОЯ

```bash
curl -I http://127.0.0.1:3000          # HTTP 2xx/3xx = OK
pm2 status                             # asi-landing online, 0 restarts
pm2 logs asi-landing --lines 20        # нет FATAL/unhandled
```

В браузере: открыть главную + RU-страницу + проверить локаль.

---

## ЗАПРЕЩЕНО

- **Не делать `pm2 restart`** вручную — только через `deploy.sh` или `rollback.sh`
- **Не запускать `pm2 delete` / `pm2 kill`** в продакшне без rollback-плана
- **Не деплоить при failed build** — если build упал, чинить локально и пушить снова
- **Не запускать два деплоя параллельно** — один агент/сессия за раз
- **Не редактировать файлы напрямую на сервере** — только через git push + deploy.sh
- **Не делать `git reset --hard` на сервере** вручную — использовать rollback.sh

---

## ЕСЛИ ДЕПЛОЙ ЗАВИС / УПАЛ

1. Проверить: `pm2 status` — процесс живой?
2. Если build упал → `rollback.sh` → починить локально → push → deploy снова
3. Если healthcheck не прошёл → `rollback.sh` немедленно
4. Если nginx не стартует → `nginx -t` → смотреть конфиг ошибку
