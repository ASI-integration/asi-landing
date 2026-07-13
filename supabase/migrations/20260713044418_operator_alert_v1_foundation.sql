-- Operator Alert v1.1, Part 1: canonical account-scoped alert foundation.
-- This is intentionally staged: legacy rows whose booking has no account remain
-- nullable until production reconciliation can be planned separately.

ALTER TABLE public.booking_ops_alerts
  ADD COLUMN IF NOT EXISTS account_id TEXT,
  ADD COLUMN IF NOT EXISTS incident_family TEXT,
  ADD COLUMN IF NOT EXISTS source_domain TEXT,
  ADD COLUMN IF NOT EXISTS recommended_action TEXT;

UPDATE public.booking_ops_alerts AS alert
SET account_id = booking.account_id
FROM public.booking_ops_records AS booking
WHERE booking.id = alert.booking_id
  AND alert.account_id IS NULL
  AND booking.account_id IS NOT NULL;

UPDATE public.booking_ops_alerts
SET incident_family = COALESCE(incident_family, CASE
      WHEN left(alert_code, 9) = 'CLEANING_' THEN 'CLEANING_DELAY'
      WHEN left(alert_code, 6) = 'LINEN_' THEN 'LINEN_DELAY'
      WHEN left(alert_code, 11) = 'INSPECTION_' THEN 'INSPECTION_DELAY'
      WHEN left(alert_code, 15) = 'UNIT_NOT_READY_'
        OR alert_code = 'READY_DEADLINE_MISSED' THEN 'READINESS_DELAY'
      ELSE alert_code
    END),
    source_domain = COALESCE(source_domain, 'turnover'),
    recommended_action = COALESCE(recommended_action, description)
WHERE incident_family IS NULL
   OR source_domain IS NULL
   OR recommended_action IS NULL;

ALTER TABLE public.booking_ops_alerts
  ALTER COLUMN incident_family SET NOT NULL,
  ALTER COLUMN source_domain SET NOT NULL,
  ALTER COLUMN recommended_action SET NOT NULL;

ALTER TABLE public.booking_ops_alerts
  DROP CONSTRAINT IF EXISTS booking_ops_alerts_source_gate_check;

ALTER TABLE public.booking_ops_alerts
  ADD CONSTRAINT booking_ops_alerts_account_id_nonempty
    CHECK (account_id IS NULL OR length(btrim(account_id)) > 0),
  ADD CONSTRAINT booking_ops_alerts_incident_family_nonempty
    CHECK (length(btrim(incident_family)) > 0),
  ADD CONSTRAINT booking_ops_alerts_source_domain_nonempty
    CHECK (length(btrim(source_domain)) > 0),
  ADD CONSTRAINT booking_ops_alerts_source_gate_nonempty
    CHECK (length(btrim(source_gate)) > 0),
  ADD CONSTRAINT booking_ops_alerts_recommended_action_nonempty
    CHECK (length(btrim(recommended_action)) > 0);

CREATE INDEX IF NOT EXISTS idx_booking_ops_alerts_account_queue
  ON public.booking_ops_alerts(account_id, status, severity, next_check_in_at, deadline_at);

CREATE OR REPLACE FUNCTION public.set_booking_ops_alert_account_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  booking_account_id TEXT;
BEGIN
  SELECT record.account_id
  INTO booking_account_id
  FROM public.booking_ops_records AS record
  WHERE record.id = NEW.booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_not_found' USING ERRCODE = '23503';
  END IF;

  IF booking_account_id IS NULL OR length(btrim(booking_account_id)) = 0 THEN
    RAISE EXCEPTION 'booking_account_missing' USING ERRCODE = '23502';
  END IF;

  IF NEW.account_id IS NOT NULL AND NEW.account_id <> booking_account_id THEN
    RAISE EXCEPTION 'alert_booking_account_mismatch' USING ERRCODE = '23514';
  END IF;

  NEW.account_id := booking_account_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_ops_alerts_set_account_id ON public.booking_ops_alerts;
CREATE TRIGGER booking_ops_alerts_set_account_id
  BEFORE INSERT OR UPDATE OF booking_id, account_id
  ON public.booking_ops_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_booking_ops_alert_account_id();

REVOKE ALL ON FUNCTION public.set_booking_ops_alert_account_id() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_booking_ops_alert_account_id() TO service_role;

COMMENT ON COLUMN public.booking_ops_alerts.account_id IS
  'Canonical account ownership. Nullable only for unreconciled legacy rows; new writes are populated and validated from booking_ops_records.';

NOTIFY pgrst, 'reload schema';
