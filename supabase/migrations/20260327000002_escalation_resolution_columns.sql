-- Escalation resolution columns.
--
-- Adds operator resolution metadata to tg_escalation_events so resolutions
-- are durable and auditable without touching existing rows.
--
-- All DDL uses ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE tg_escalation_events
  ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by        TEXT,
  ADD COLUMN IF NOT EXISTS resolution_action  TEXT,
  ADD COLUMN IF NOT EXISTS operator_note      TEXT;

-- Index to quickly find unresolved escalations per chat.
CREATE INDEX IF NOT EXISTS idx_tg_escalation_events_unresolved
  ON tg_escalation_events (chat_id, created_at DESC)
  WHERE resolved_at IS NULL;
