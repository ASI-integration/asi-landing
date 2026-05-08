-- Operations persistence foundation.
--
-- Scope:
--   - Manual/semi-automatic operations workflow only.
--   - No PMS, OTA, channel-manager, or accommodation-fact integration.
--   - Service-role access through backend APIs; dashboard clients never query tables directly.

CREATE TABLE IF NOT EXISTS operations_items (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id        UUID        REFERENCES users(id) ON DELETE SET NULL,

  guest_name               TEXT        NOT NULL,
  guest_email              TEXT,
  guest_phone              TEXT,
  guest_channel            TEXT        NOT NULL,
  guest_external_contact_id TEXT,
  source_channel           TEXT        NOT NULL,

  property_id              TEXT,
  object_id                TEXT,
  object_label             TEXT        NOT NULL,

  booking_check_in         DATE,
  booking_check_out        DATE,
  booking_nights           INTEGER     CHECK (booking_nights IS NULL OR booking_nights >= 0),

  workflow_stage           TEXT        NOT NULL DEFAULT 'new_inquiry',
  automation_mode          TEXT        NOT NULL DEFAULT 'manual',
  issue_status             TEXT        NOT NULL DEFAULT 'none',
  escalation_status        TEXT        NOT NULL DEFAULT 'none',

  communication_review_id  TEXT,
  communication_session_id TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT operations_items_guest_channel_check
    CHECK (guest_channel IN (
      'telegram', 'telegram_voice', 'whatsapp_voice', 'vk', 'email',
      'phone', 'max', 'direct', 'manual', 'demo'
    )),

  CONSTRAINT operations_items_source_channel_check
    CHECK (source_channel IN (
      'telegram', 'telegram_voice', 'whatsapp_voice', 'vk', 'email',
      'phone', 'max', 'direct', 'manual', 'demo'
    )),

  CONSTRAINT operations_items_workflow_stage_check
    CHECK (workflow_stage IN (
      'new_inquiry', 'booking_intake', 'pre_checkin', 'checkin',
      'in_stay', 'checkout', 'review_followup', 'needs_operator'
    )),

  CONSTRAINT operations_items_automation_mode_check
    CHECK (automation_mode IN ('manual', 'semi_auto', 'full_auto')),

  CONSTRAINT operations_items_issue_status_check
    CHECK (issue_status IN ('none', 'open', 'in_progress', 'resolved')),

  CONSTRAINT operations_items_escalation_status_check
    CHECK (escalation_status IN ('none', 'pending_operator', 'in_review', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_operations_items_account_id
  ON operations_items(account_id);

CREATE INDEX IF NOT EXISTS idx_operations_items_stage
  ON operations_items(account_id, workflow_stage);

CREATE INDEX IF NOT EXISTS idx_operations_items_property_id
  ON operations_items(account_id, property_id);

CREATE INDEX IF NOT EXISTS idx_operations_items_check_in
  ON operations_items(account_id, booking_check_in);

CREATE INDEX IF NOT EXISTS idx_operations_items_check_out
  ON operations_items(account_id, booking_check_out);

CREATE INDEX IF NOT EXISTS idx_operations_items_updated_at
  ON operations_items(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS operations_issues (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_item_id         UUID        NOT NULL REFERENCES operations_items(id) ON DELETE CASCADE,
  title                    TEXT        NOT NULL,
  issue_type               TEXT        NOT NULL DEFAULT 'other',
  urgency                  TEXT        NOT NULL DEFAULT 'normal',
  status                   TEXT        NOT NULL DEFAULT 'open',
  communication_review_id  TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at              TIMESTAMPTZ,

  CONSTRAINT operations_issues_type_check
    CHECK (issue_type IN (
      'booking_context', 'guest_support', 'property_context', 'payment_review',
      'maintenance_review', 'communication', 'other'
    )),

  CONSTRAINT operations_issues_urgency_check
    CHECK (urgency IN ('normal', 'urgent')),

  CONSTRAINT operations_issues_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_operations_issues_account_id
  ON operations_issues(account_id);

CREATE INDEX IF NOT EXISTS idx_operations_issues_item_id
  ON operations_issues(operation_item_id);

CREATE INDEX IF NOT EXISTS idx_operations_issues_status
  ON operations_issues(account_id, status);

CREATE INDEX IF NOT EXISTS idx_operations_issues_urgency
  ON operations_issues(account_id, urgency);

CREATE TABLE IF NOT EXISTS operations_notes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_item_id   UUID        NOT NULL REFERENCES operations_items(id) ON DELETE CASCADE,
  issue_id           UUID        REFERENCES operations_issues(id) ON DELETE CASCADE,
  body               TEXT        NOT NULL,
  author             TEXT,
  created_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operations_notes_account_id
  ON operations_notes(account_id);

CREATE INDEX IF NOT EXISTS idx_operations_notes_item_id
  ON operations_notes(operation_item_id);

CREATE INDEX IF NOT EXISTS idx_operations_notes_issue_id
  ON operations_notes(issue_id);

CREATE INDEX IF NOT EXISTS idx_operations_notes_created_at
  ON operations_notes(operation_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operations_audit_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_item_id   UUID        NOT NULL REFERENCES operations_items(id) ON DELETE CASCADE,
  issue_id           UUID        REFERENCES operations_issues(id) ON DELETE CASCADE,
  event_type         TEXT        NOT NULL,
  label              TEXT        NOT NULL,
  detail             TEXT,
  tone               TEXT        NOT NULL DEFAULT 'normal',
  created_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT operations_audit_events_type_check
    CHECK (event_type IN (
      'item_created', 'stage_changed', 'checklist_item_completed',
      'issue_created', 'escalated', 'note_added', 'checked_in',
      'checked_out', 'issue_resolved', 'checkin_ready'
    )),

  CONSTRAINT operations_audit_events_tone_check
    CHECK (tone IN ('normal', 'warn', 'success'))
);

CREATE INDEX IF NOT EXISTS idx_operations_audit_account_id
  ON operations_audit_events(account_id);

CREATE INDEX IF NOT EXISTS idx_operations_audit_item_id
  ON operations_audit_events(operation_item_id);

CREATE INDEX IF NOT EXISTS idx_operations_audit_issue_id
  ON operations_audit_events(issue_id);

CREATE INDEX IF NOT EXISTS idx_operations_audit_created_at
  ON operations_audit_events(operation_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operations_checklist_items (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_item_id   UUID        NOT NULL REFERENCES operations_items(id) ON DELETE CASCADE,
  checklist_stage    TEXT        NOT NULL,
  checklist_item_id  TEXT        NOT NULL,
  label              TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'pending',
  note               TEXT,
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT operations_checklist_stage_check
    CHECK (checklist_stage IN ('pre_checkin', 'checkin', 'in_stay', 'checkout', 'review_followup')),

  CONSTRAINT operations_checklist_status_check
    CHECK (status IN ('pending', 'done', 'blocked', 'not_applicable')),

  CONSTRAINT operations_checklist_item_unique
    UNIQUE (operation_item_id, checklist_stage, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS idx_operations_checklist_account_id
  ON operations_checklist_items(account_id);

CREATE INDEX IF NOT EXISTS idx_operations_checklist_item_id
  ON operations_checklist_items(operation_item_id);

CREATE INDEX IF NOT EXISTS idx_operations_checklist_stage
  ON operations_checklist_items(operation_item_id, checklist_stage, sort_order);

ALTER TABLE operations_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON operations_items;
DROP POLICY IF EXISTS "service_role_full_access" ON operations_issues;
DROP POLICY IF EXISTS "service_role_full_access" ON operations_notes;
DROP POLICY IF EXISTS "service_role_full_access" ON operations_audit_events;
DROP POLICY IF EXISTS "service_role_full_access" ON operations_checklist_items;

CREATE POLICY "service_role_full_access"
  ON operations_items
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON operations_issues
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON operations_notes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON operations_audit_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access"
  ON operations_checklist_items
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

