-- OPS Board v1: minimal operator task layer for ASI pilot.
-- Service-role only; dashboard accesses via backend APIs.

CREATE TABLE IF NOT EXISTS ops_operator_tasks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type        TEXT        NOT NULL,
  task_status      TEXT        NOT NULL DEFAULT 'new',
  priority         TEXT        NOT NULL DEFAULT 'normal',
  source           TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  description      TEXT,
  object_id        TEXT,
  contact_id       TEXT,
  guest_name       TEXT,
  owner_name       TEXT,
  object_label     TEXT,
  last_event_text  TEXT,
  last_event_at    TIMESTAMPTZ,
  dedup_key        TEXT,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ,

  CONSTRAINT ops_operator_tasks_type_check
    CHECK (task_type IN (
      'prepare_checkin',
      'prepare_checkout',
      'verify_cleaning',
      'verify_guest_issue',
      'request_owner_data',
      'verify_channel_manager',
      'contact_owner',
      'other'
    )),

  CONSTRAINT ops_operator_tasks_status_check
    CHECK (task_status IN (
      'new',
      'in_progress',
      'waiting_owner',
      'needs_operator',
      'done',
      'closed'
    )),

  CONSTRAINT ops_operator_tasks_priority_check
    CHECK (priority IN ('normal', 'urgent', 'critical')),

  CONSTRAINT ops_operator_tasks_source_check
    CHECK (source IN (
      'telegram',
      'crm',
      'communication_autopilot',
      'channel_manager',
      'manual'
    ))
);

CREATE INDEX IF NOT EXISTS idx_ops_operator_tasks_status
  ON ops_operator_tasks(task_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_operator_tasks_contact_id
  ON ops_operator_tasks(contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_operator_tasks_object_id
  ON ops_operator_tasks(object_id)
  WHERE object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_operator_tasks_dedup_open
  ON ops_operator_tasks(dedup_key)
  WHERE dedup_key IS NOT NULL
    AND task_status IN ('new', 'in_progress', 'waiting_owner', 'needs_operator');

ALTER TABLE ops_operator_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON ops_operator_tasks;

CREATE POLICY "service_role_full_access"
  ON ops_operator_tasks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
