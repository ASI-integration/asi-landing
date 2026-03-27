-- Minimum operational task layer for short-term rental operations.
--
-- Creates ops_tasks table linking reservation / property / chat together
-- so the communication layer and ops layer remain joined around the same stay.
--
-- Idempotency:
--   dedup_key has a UNIQUE constraint. Task creation uses ON CONFLICT DO NOTHING
--   so harmless retries never produce duplicate rows.
--
-- RLS:
--   Service-role only (backend). No anon or authenticated access.

-- ─── Main table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      TEXT        NOT NULL,
  reservation_id   TEXT,
  chat_id          BIGINT,
  task_type        TEXT        NOT NULL CHECK (task_type IN (
                     'pre_arrival_prep', 'checkin_ready', 'guest_issue',
                     'checkout', 'turnover'
                   )),
  task_status      TEXT        NOT NULL DEFAULT 'open' CHECK (task_status IN (
                     'open', 'in_progress', 'resolved', 'canceled'
                   )),
  title            TEXT        NOT NULL,
  description      TEXT,
  due_at           TIMESTAMPTZ,
  priority         TEXT        NOT NULL DEFAULT 'normal' CHECK (priority IN (
                     'emergency', 'urgent', 'normal', 'informational'
                   )),
  assigned_to      TEXT,
  source_event     TEXT,
  trigger_reason   TEXT,
  operator_note    TEXT,
  -- Idempotency: one dedup_key per semantically-unique task creation intent.
  -- Convention: "{task_type}:{reservation_id}" or "{task_type}:{reservation_id}:{chat_id}"
  dedup_key        TEXT        UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ops_tasks_property_id
  ON ops_tasks (property_id);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_reservation_id
  ON ops_tasks (reservation_id);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_task_status
  ON ops_tasks (task_status);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_task_type
  ON ops_tasks (task_type);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_due_at
  ON ops_tasks (due_at);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE ops_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON ops_tasks;

CREATE POLICY "service_role_full_access"
  ON ops_tasks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
