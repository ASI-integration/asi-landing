# ASI Owner Development Console v1

Закрытая владельческая консоль разработки в опубликованном ASI-кабинете. Использует существующий durable ASI Runtime Bridge. Не создаёт второй Runtime, вторую очередь и не использует snapshot-контур как очередь.

## Route

- UI: `/dashboard/development`
- APIs:
  - `GET/POST /api/dashboard/development/tasks`
  - `GET /api/dashboard/development/tasks/[taskId]`
  - `POST /api/dashboard/development/tasks/[taskId]/decisions`
  - `POST /api/dashboard/development/tasks/[taskId]/merge`

## Required deployment configuration

Set this server-only env name (comma-separated emails):

- `ASI_DEVELOPMENT_OWNER_EMAILS`

Also required for bridge operations (isolated Runtime Bridge Supabase project — not the primary app database):

- `ASI_RUNTIME_BRIDGE_CLIENT_ID`
- `ASI_RUNTIME_BRIDGE_SUPABASE_URL`
- `ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY`

Runner baseline recovery also requires `ASI_RUNTIME_BRIDGE_CHECKOUTS_JSON`: a JSON array with exactly two Runtime checkout identities and absolute paths:

```json
[{"id":"runtime-primary","path":"/srv/asi-runtime/primary"},{"id":"runtime-secondary","path":"/srv/asi-runtime/secondary"}]
```

Paths stay runner-only and are never returned to the browser. Each checkout must be clean and have `origin` bound to the allowlisted repository.

All three Bridge variables must be present and well-formed. Missing Bridge storage configuration returns a safe Russian `503` (`Runtime Bridge не настроен.`) without URLs, keys, or stack traces.

Server-side PR merge also requires `GITHUB_TOKEN` with the narrow repository permission needed to merge pull requests. The value stays server-only and is never returned to the browser. Without it, the merge endpoint fails closed with a structured `merge_provider_not_configured` blocker.

Primary application auth/CRM/accounts continue to use `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`. Do not point those at the Bridge project and do not put Bridge credentials behind `NEXT_PUBLIC_*`.

Do not set owner emails or bridge tokens/keys via `NEXT_PUBLIC_*`.

## Verify owner access

1. Sign in to the ASI cabinet with an account whose email is listed in `ASI_DEVELOPMENT_OWNER_EMAILS`.
2. Confirm sidebar shows **Разработка ASI**.
3. Open `/dashboard/development` and confirm the task form is visible.
4. Sign in as a CRM operator who is **not** on `ASI_DEVELOPMENT_OWNER_EMAILS` and confirm:
   - sidebar item is hidden;
   - direct navigation shows «Нет доступа»;
   - API routes return `403`.
5. In production, empty `ASI_DEVELOPMENT_OWNER_EMAILS` means deny-by-default for everyone.

## Create a task

1. Open `/dashboard/development`.
2. Choose allowlisted repository (`ASI-integration/asi-landing` in v1).
3. В поле **Что нужно сделать?** опишите задачу обычным языком. Номер GitHub Issue не нужен.
4. При необходимости откройте **Расширенные настройки** и переопределите название, цель или инструкции.
5. Click **Запустить задачу**.
6. URL becomes `/dashboard/development?taskId=<uuid>` and status polling starts.

Название, цель, инструкции, acceptance criteria и стандартные safety constraints формируются на сервере. Расширенные значения необязательны; safety constraints не снимаются. Последний выбранный allowlisted repository сохраняется в локальном browser storage и повторно проверяется против server allowlist при загрузке.

Baseline SHA is resolved on the server from the allowlisted repository `main` tip. The browser never supplies baseline SHA. Перед executor runner проверяет оба настроенных checkout. Чистые checkout безопасно переводятся в detached state точного baseline; dirty checkout не сбрасывается.

Если executor возвращает `runtime_baseline_mismatch`, runner не публикует этот промежуточный результат владельцу: он повторно синхронизирует checkout и запускает тот же task identity ещё один раз. Повторный mismatch, ошибка recovery или ошибка retry становятся terminal safe result с `record_identity`, стабильным blocker code и checkout identity без локального пути, stdout/stderr или credentials.

Exact HTTP retries reuse the browser idempotency key until a successful response. The server looks up an existing durable task by `client_id` + idempotency key before creating a new submission, so a retry still returns the original task even if `main` tip SHA changed. Tasks and owner gates are bound to the authenticated owner's deterministic conversation scope.

## Open a PR

When the terminal safe result contains artifact `type=pull_request` with an HTTPS GitHub PR URL for the allowlisted ASI repository, the console shows **Открыть PR** (`target=_blank`, `rel=noopener noreferrer`). Invalid hosts/repositories are not rendered as links.

## Merge owner gate

Control Center never trusts a browser-supplied approval flag. For a PR artifact it reads the canonical `asi.agent-os.owner-gate.v1` records from Owner Decision Bus Issue #106 and the related PR discussion/reviews, then compares the approval target and SHA with the current GitHub PR head.

The review state is one of `pending`, `passed`, `failed`, `stale_sha`, or `head_changed`. The effective merge state is always either `blocked` or `merge_allowed`. The UI keeps **Объединить PR** disabled unless the server reports `passed` and `merge_allowed` for the exact current SHA.

`POST /api/dashboard/development/tasks/[taskId]/merge` repeats every check server-side:

1. the authenticated owner owns the exact durable task;
2. the task completed with the exact allowlisted PR artifact supplied to the endpoint;
3. one canonical explicit-owner approval matches `merge`, `owner/repository#PR`, task identity and the exact current head SHA;
4. rejected, expired, consumed, conflicting, missing, old-SHA and unrelated approvals fail closed;
5. the final GitHub merge request includes the same exact head SHA as an atomic precondition.

Blocked responses include a stable reason code, repository, PR number, expected SHA, current SHA, approved SHA and approval task ID. A head change therefore invalidates the old approval automatically even if the browser has stale state. Identical owner artifacts are deduplicated by `taskId` and identical merge retries use a deterministic request ID; an already merged exact head returns an idempotent success.

Successful server authorization and merge return the canonical marker `CONTROL_CENTER_OWNER_GATE_MERGE_BLOCK_PASSED`.

## Handle an owner gate

1. When status is `awaiting_owner`, review action, exact target, identity, reason, evidence, allowed side effect, rollback, post-action verification, and `expiresAt`.
2. Click **Одобрить** or **Отклонить**.
3. Confirm again in the confirmation panel.
4. After submit, the console refreshes immediately:
   - approved → task returns to `queued` / `running`;
   - rejected → terminal safe result.

No force-release, lease mutation, durable-task deletion, or fencing bypass is exposed.

## Secrets that must never reach the browser

- `ASI_RUNTIME_BRIDGE_CHAT_TOKEN`
- `ASI_RUNTIME_BRIDGE_OWNER_TOKEN`
- `ASI_RUNTIME_BRIDGE_RUNNER_TOKEN`
- `ASI_RUNTIME_BRIDGE_SUPABASE_URL`
- `ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`
- Values of `ASI_DEVELOPMENT_OWNER_EMAILS`
- Lease tokens, runner credentials, raw stdout/stderr, local paths

Session JSON may expose only the boolean `isDevelopmentOwner`.

## Rollback

1. Remove or empty `ASI_DEVELOPMENT_OWNER_EMAILS` in the deployment environment (production becomes deny-by-default), **or**
2. Roll back the exact release SHA that introduced this console.

No production deploy, env mutation, merge, or production data change is performed by this documentation alone.
