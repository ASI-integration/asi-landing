-- Location report payments now use either manual confirmation or YooKassa redirect.

UPDATE location_report_requests
SET payment_provider = 'manual'
WHERE payment_provider = 'prodamus';

ALTER TABLE location_report_requests
  DROP CONSTRAINT IF EXISTS location_report_requests_payment_provider_check;

ALTER TABLE location_report_requests
  ADD CONSTRAINT location_report_requests_payment_provider_check
  CHECK (payment_provider IN ('manual', 'yookassa'));
