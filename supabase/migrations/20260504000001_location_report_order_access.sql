-- RU paid location report order/access skeleton.
-- Adds server-owned access/payment state to existing async report requests.

ALTER TABLE location_report_requests
  ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_id UUID NULL REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email TEXT NULL,
  ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS payment_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS payment_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS product_type TEXT NOT NULL DEFAULT 'location_report_detail';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_report_requests_access_status_check'
  ) THEN
    ALTER TABLE location_report_requests
      ADD CONSTRAINT location_report_requests_access_status_check
      CHECK (access_status IN ('draft', 'pending_payment', 'paid', 'generated', 'expired'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_report_requests_payment_provider_check'
  ) THEN
    ALTER TABLE location_report_requests
      ADD CONSTRAINT location_report_requests_payment_provider_check
      CHECK (payment_provider IN ('manual', 'prodamus', 'yookassa'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'location_report_requests_product_type_check'
  ) THEN
    ALTER TABLE location_report_requests
      ADD CONSTRAINT location_report_requests_product_type_check
      CHECK (product_type IN ('location_report_detail'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_location_report_requests_access_status_created_at
  ON location_report_requests(access_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_location_report_requests_report_id
  ON location_report_requests(report_id);

CREATE INDEX IF NOT EXISTS idx_location_report_requests_payment_id
  ON location_report_requests(payment_id);

CREATE INDEX IF NOT EXISTS idx_location_report_requests_payment_provider_created_at
  ON location_report_requests(payment_provider, created_at DESC);
