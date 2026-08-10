-- Guest Lifecycle production schema repair: reservation temporal fields.
--
-- Production drift left tg_guest_reservations.check_in/check_out as DATE while
-- the canonical guest-memory schema and production acceptance use TIMESTAMPTZ.
-- Add the missing access_verified_at field and upgrade DATE columns in a
-- deterministic, idempotent way. Existing DATE values are interpreted as
-- midnight UTC so the conversion does not depend on the SQL session timezone.

ALTER TABLE public.tg_guest_reservations
  ADD COLUMN IF NOT EXISTS access_verified_at TIMESTAMPTZ;

DO $repair$
DECLARE
  v_check_in_type text;
  v_check_out_type text;
BEGIN
  SELECT c.udt_name
    INTO v_check_in_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'tg_guest_reservations'
    AND c.column_name = 'check_in';

  SELECT c.udt_name
    INTO v_check_out_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'tg_guest_reservations'
    AND c.column_name = 'check_out';

  IF v_check_in_type = 'date' THEN
    ALTER TABLE public.tg_guest_reservations
      ALTER COLUMN check_in TYPE TIMESTAMPTZ
      USING (check_in::timestamp AT TIME ZONE 'UTC');
  ELSIF v_check_in_type IS DISTINCT FROM 'timestamptz' THEN
    RAISE EXCEPTION 'tg_guest_reservations_check_in_unexpected_type:%', COALESCE(v_check_in_type, 'missing');
  END IF;

  IF v_check_out_type = 'date' THEN
    ALTER TABLE public.tg_guest_reservations
      ALTER COLUMN check_out TYPE TIMESTAMPTZ
      USING (check_out::timestamp AT TIME ZONE 'UTC');
  ELSIF v_check_out_type IS DISTINCT FROM 'timestamptz' THEN
    RAISE EXCEPTION 'tg_guest_reservations_check_out_unexpected_type:%', COALESCE(v_check_out_type, 'missing');
  END IF;
END
$repair$;

NOTIFY pgrst, 'reload schema';
