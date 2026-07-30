# ASI Owner Development Console v1

Закрытая владельческая консоль разработки в опубликованном ASI-кабинете. Использует существующий durable ASI Runtime Bridge. Не создаёт второй Runtime, вторую очередь и не использует snapshot-контур как очередь.

## Route

- UI: `/dashboard/development`
- APIs:
  - `GET/POST /api/dashboard/development/tasks`
  - `GET /api/dashboard/development/tasks/[taskId]`
  - `POST /api/dashboard/development/tasks/[taskId]/decisions`

## Required deployment configuration

Set this server-only env name (comma-separated emails):

- `ASI_DEVELOPMENT_OWNER_EMAILS`

Also required for bridge operations (already part of Runtime Bridge):

- `ASI_RUNTIME_BRIDGE_CLIENT_ID`
- Supabase service role used by existing bridge repository (server-only)

Do not set owner emails or bridge tokens via `NEXT_PUBLIC_*`.

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
3. Fill title, objective, instructions.
4. Click **Запустить задачу**.
5. URL becomes `/dashboard/development?taskId=<uuid>` and status polling starts.

Baseline SHA is resolved on the server from the allowlisted repository `main` tip. The browser never supplies baseline SHA.

Exact HTTP retries reuse the browser idempotency key until a successful response. The server looks up an existing durable task by `client_id` + idempotency key before creating a new submission, so a retry still returns the original task even if `main` tip SHA changed. Tasks and owner gates are bound to the authenticated owner's deterministic conversation scope.

## Open a PR

When the terminal safe result contains artifact `type=pull_request` with an HTTPS GitHub PR URL for the allowlisted ASI repository, the console shows **Открыть PR** (`target=_blank`, `rel=noopener noreferrer`). Invalid hosts/repositories are not rendered as links.

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
- `SUPABASE_SERVICE_ROLE_KEY`
- Values of `ASI_DEVELOPMENT_OWNER_EMAILS`
- Lease tokens, runner credentials, raw stdout/stderr, local paths

Session JSON may expose only the boolean `isDevelopmentOwner`.

## Rollback

1. Remove or empty `ASI_DEVELOPMENT_OWNER_EMAILS` in the deployment environment (production becomes deny-by-default), **or**
2. Roll back the exact release SHA that introduced this console.

No production deploy, env mutation, merge, or production data change is performed by this documentation alone.
