-- Paid location report unlock contract.
-- Payment provider integration can stay disabled while access state is persisted.

ALTER TABLE location_report_requests
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'created'
  CHECK (payment_status IN ('created', 'pending_payment', 'paid_unlocked', 'failed', 'cancelled'));

UPDATE location_report_requests
SET payment_status = CASE
  WHEN access_tier = 'paid_required' AND status = 'completed' THEN 'paid_unlocked'
  WHEN access_tier = 'paid_required' THEN 'pending_payment'
  WHEN access_tier = 'included' THEN 'paid_unlocked'
  ELSE payment_status
END
WHERE payment_status = 'created';

CREATE INDEX IF NOT EXISTS idx_location_report_requests_payment_status_created_at
  ON location_report_requests(payment_status, created_at DESC);
