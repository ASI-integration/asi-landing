ALTER TABLE location_report_requests
  ADD COLUMN IF NOT EXISTS report_intake JSONB NULL;
