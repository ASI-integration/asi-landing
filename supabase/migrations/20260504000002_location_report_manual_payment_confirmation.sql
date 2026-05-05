-- Manual payment confirmation for location report requests.
-- Keeps this temporary flow provider-neutral: reports are generated before payment,
-- and manual confirmation only grants access to the precomputed report.

ALTER TABLE location_report_requests
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ NULL;

ALTER TABLE location_report_requests
  DROP CONSTRAINT IF EXISTS location_report_requests_access_status_check;

ALTER TABLE location_report_requests
  ADD CONSTRAINT location_report_requests_access_status_check
  CHECK (access_status IN ('draft', 'pending_payment', 'paid', 'granted', 'generated', 'expired'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_report_requests_report_id_fkey'
  ) THEN
    ALTER TABLE location_report_requests
      ADD CONSTRAINT location_report_requests_report_id_fkey
      FOREIGN KEY (report_id)
      REFERENCES location_standalone_reports(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;
