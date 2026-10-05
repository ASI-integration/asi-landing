-- Wave 5: atomic canonical account/property guard for new Booking Ops records.
-- Additive and intentionally INSERT-only so existing legacy/unbound rows keep
-- their current update semantics until a separate type/data normalization pass.

CREATE OR REPLACE FUNCTION public.booking_ops_record_insert_scope_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legacy/accountless/property-unbound intake stays review-only and is not
  -- forced through the canonical property invariant at insert time.
  IF NEW.account_id IS NULL
     OR btrim(NEW.account_id) = ''
     OR NEW.account_id = 'legacy'
     OR NEW.property_id IS NULL
     OR btrim(NEW.property_id) = '' THEN
    RETURN NEW;
  END IF;

  -- Compare as text because booking_ops_records evolved with TEXT scope columns
  -- while canonical properties use UUID ids. FOR SHARE keeps ownership stable
  -- for the duration of this INSERT transaction.
  PERFORM 1
  FROM public.properties p
  WHERE p.id::text = btrim(NEW.property_id)
    AND p.account_id::text = btrim(NEW.account_id)
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking_ops_record_scope_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.booking_ops_record_insert_scope_guard_v1() TO service_role;

DROP TRIGGER IF EXISTS booking_ops_record_insert_scope_guard_v1
  ON public.booking_ops_records;

CREATE TRIGGER booking_ops_record_insert_scope_guard_v1
BEFORE INSERT ON public.booking_ops_records
FOR EACH ROW
EXECUTE FUNCTION public.booking_ops_record_insert_scope_guard_v1();
