-- Last known ASI Runtime state per cabinet user (one row per user).

CREATE TABLE IF NOT EXISTS asi_runtime_snapshots (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  status TEXT NOT NULL,
  current_stage TEXT NOT NULL DEFAULT '',
  completed_steps INTEGER NOT NULL DEFAULT 0 CHECK (completed_steps >= 0),
  total_steps INTEGER NOT NULL DEFAULT 0 CHECK (total_steps >= 0),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  provider TEXT NOT NULL DEFAULT '',
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  commit_sha TEXT NULL,
  pull_request_url TEXT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unknown',
  last_event TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_asi_runtime_snapshots_updated_at
  ON asi_runtime_snapshots(updated_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at_asi_runtime_snapshots()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asi_runtime_snapshots_updated_at ON asi_runtime_snapshots;
CREATE TRIGGER trg_asi_runtime_snapshots_updated_at
BEFORE UPDATE ON asi_runtime_snapshots
FOR EACH ROW EXECUTE FUNCTION set_updated_at_asi_runtime_snapshots();
