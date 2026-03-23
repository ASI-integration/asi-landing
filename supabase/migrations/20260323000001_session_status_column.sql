-- Add operational session status tracking to conversation sessions.
-- Required for the session-status.ts state machine to persist across
-- serverless cold starts.
--
-- Run via:  supabase db push  (with linked project)
-- Or paste directly into: Supabase Dashboard → SQL Editor

ALTER TABLE tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'inquiry',
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

-- Backfill existing rows so status_updated_at is not null.
UPDATE tg_conversation_sessions
  SET status_updated_at = updated_at
  WHERE status_updated_at IS NULL;

-- Index for cron sweep query: status + status_updated_at.
CREATE INDEX IF NOT EXISTS idx_tg_conv_sess_status
  ON tg_conversation_sessions (status, status_updated_at)
  WHERE status = 'payment_pending';
