-- API-first channel manager guardrails and Russian OTA adapter contour.
-- Real OTA calls are intentionally not connected here.

ALTER TABLE cm_channels
  ADD COLUMN IF NOT EXISTS integration_type TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_auto_sell_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_overbooking_protection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reliability_level INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supports_availability_push BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supports_rates_push BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supports_restrictions_push BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supports_booking_pull BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supports_booking_webhook BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supports_cancellation_webhook BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supports_modification_webhook BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

UPDATE cm_channels
SET code = 'cian_daily', name = 'Циан посуточно'
WHERE code = 'cian';

ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_code_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_status_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_adapter_kind_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_integration_type_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_sync_mode_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_api_first_guardrail_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_reliability_check;
ALTER TABLE cm_channels DROP CONSTRAINT IF EXISTS cm_channels_commission_check;

ALTER TABLE cm_channels
  ADD CONSTRAINT cm_channels_code_check
    CHECK (code IN (
      'yandex_travel',
      'ostrovok',
      'sutochno',
      'avito_travel',
      'one_zero_one_hotels',
      'bronevik_mts_travel',
      'cian_daily',
      'manual',
      'email_parsing',
      'ical',
      'mock'
    )),
  ADD CONSTRAINT cm_channels_adapter_kind_check
    CHECK (adapter_kind IN ('mock', 'manual', 'api')),
  ADD CONSTRAINT cm_channels_status_check
    CHECK (status IN ('planned', 'mocked', 'ready_for_credentials', 'sandbox', 'active', 'disabled', 'error')),
  ADD CONSTRAINT cm_channels_integration_type_check
    CHECK (integration_type IN ('api', 'partner_channel_manager_api', 'ical', 'manual', 'email_parsing', 'mock')),
  ADD CONSTRAINT cm_channels_sync_mode_check
    CHECK (sync_mode IN ('disabled', 'read_only', 'shadow', 'active')),
  ADD CONSTRAINT cm_channels_api_first_guardrail_check
    CHECK (
      (
        integration_type IN ('api', 'partner_channel_manager_api')
      )
      OR (
        sync_mode <> 'active'
        AND is_auto_sell_enabled = FALSE
        AND is_overbooking_protection_enabled = FALSE
      )
    ),
  ADD CONSTRAINT cm_channels_reliability_check
    CHECK (reliability_level BETWEEN 0 AND 100),
  ADD CONSTRAINT cm_channels_commission_check
    CHECK (commission_percent >= 0 AND commission_percent <= 100);

ALTER TABLE cm_reservations
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS channel_reliability_level INT,
  ADD COLUMN IF NOT EXISTS guest_type TEXT,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE cm_reservations SET channel_code = 'cian_daily' WHERE channel_code = 'cian';

ALTER TABLE cm_reservations DROP CONSTRAINT IF EXISTS cm_reservations_channel_code_check;
ALTER TABLE cm_reservations DROP CONSTRAINT IF EXISTS cm_reservations_status_check;

ALTER TABLE cm_reservations
  ADD CONSTRAINT cm_reservations_channel_code_check
    CHECK (channel_code IN (
      'yandex_travel',
      'ostrovok',
      'sutochno',
      'avito_travel',
      'one_zero_one_hotels',
      'bronevik_mts_travel',
      'cian_daily',
      'manual',
      'email_parsing',
      'ical',
      'mock'
    )),
  ADD CONSTRAINT cm_reservations_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'declined', 'conflict', 'rejected_by_inventory', 'modified'));

ALTER TABLE cm_channel_sync_jobs
  ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'active';

ALTER TABLE cm_channel_sync_jobs DROP CONSTRAINT IF EXISTS cm_channel_sync_jobs_sync_mode_check;
ALTER TABLE cm_channel_sync_jobs
  ADD CONSTRAINT cm_channel_sync_jobs_sync_mode_check CHECK (sync_mode IN ('disabled', 'read_only', 'shadow', 'active'));

CREATE OR REPLACE FUNCTION cm_reservation_priority_score(
  p_nights_count INT,
  p_total_amount NUMERIC,
  p_commission_percent NUMERIC,
  p_channel_reliability_level INT
) RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN ROUND(
    (
      GREATEST(COALESCE(p_nights_count, 0), 0) * 100
      + GREATEST(COALESCE(p_total_amount, 0), 0) / 100
      + GREATEST(COALESCE(p_channel_reliability_level, 0), 0)
      - GREATEST(COALESCE(p_commission_percent, 0), 0) * 2
    )::NUMERIC,
    2
  );
END;
$$;

CREATE OR REPLACE FUNCTION cm_enqueue_sync_jobs(
  p_account_id UUID,
  p_property_id UUID,
  p_unit_key TEXT,
  p_date_from DATE,
  p_date_to DATE,
  p_reason TEXT
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  INSERT INTO cm_channel_sync_jobs (
    account_id, channel_id, listing_id, property_id, unit_key,
    date_from, date_to, reason, sync_mode, idempotency_key
  )
  SELECT
    p_account_id,
    l.channel_id,
    l.id,
    p_property_id,
    p_unit_key,
    p_date_from,
    p_date_to,
    p_reason,
    c.sync_mode,
    p_account_id::TEXT || ':' || l.id::TEXT || ':' || p_unit_key || ':' ||
      p_date_from::TEXT || ':' || p_date_to::TEXT || ':' || p_reason || ':' ||
      c.sync_mode || ':' || FLOOR(EXTRACT(EPOCH FROM NOW()) / 60)::TEXT
  FROM cm_channel_listings l
  JOIN cm_channels c ON c.id = l.channel_id
  WHERE l.account_id = p_account_id
    AND l.property_id = p_property_id
    AND l.unit_key = p_unit_key
    AND l.status = 'active'
    AND c.is_enabled = TRUE
    AND c.sync_mode IN ('shadow', 'active')
    AND c.integration_type IN ('api', 'partner_channel_manager_api')
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS cm_create_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, DATE, INT, JSONB);

CREATE OR REPLACE FUNCTION cm_create_reservation(
  p_account_id UUID,
  p_property_id UUID,
  p_unit_key TEXT,
  p_channel_code TEXT,
  p_external_booking_id TEXT,
  p_idempotency_key TEXT,
  p_guest_name TEXT,
  p_check_in_date DATE,
  p_check_out_date DATE,
  p_quantity INT DEFAULT 1,
  p_total_amount NUMERIC DEFAULT NULL,
  p_guest_type TEXT DEFAULT NULL,
  p_confirmation_mode TEXT DEFAULT 'confirm',
  p_raw_payload JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  reservation_id UUID,
  reservation_status TEXT,
  available BOOLEAN,
  sync_jobs INT,
  idempotent BOOLEAN,
  priority_score NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit_key TEXT := COALESCE(NULLIF(p_unit_key, ''), 'default');
  v_channel cm_channels%ROWTYPE;
  v_existing cm_reservations%ROWTYPE;
  v_nights INT;
  v_locked INT;
  v_ok INT;
  v_res cm_reservations%ROWTYPE;
  v_jobs INT := 0;
  v_priority NUMERIC := 0;
  v_should_hold BOOLEAN := FALSE;
BEGIN
  IF p_check_out_date <= p_check_in_date OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_reservation_dates_or_quantity';
  END IF;

  IF p_confirmation_mode NOT IN ('confirm', 'pending') THEN
    RAISE EXCEPTION 'invalid_confirmation_mode';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_account_id::TEXT || ':' || COALESCE(p_idempotency_key, p_external_booking_id, gen_random_uuid()::TEXT))
  );

  SELECT * INTO v_existing
  FROM cm_reservations
  WHERE account_id = p_account_id
    AND (
      (p_idempotency_key IS NOT NULL AND idempotency_key = p_idempotency_key)
      OR (
        p_external_booking_id IS NOT NULL
        AND property_id = p_property_id
        AND channel_code = p_channel_code
        AND external_booking_id = p_external_booking_id
      )
    )
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO cm_channel_sync_logs (
      account_id, channel_id, direction, status, message, request_json, response_json
    )
    VALUES (
      p_account_id,
      v_existing.channel_id,
      'inbound',
      'skipped',
      'duplicate_external_booking_id',
      COALESCE(p_raw_payload, '{}'::jsonb),
      jsonb_build_object('reservation_id', v_existing.id)
    );

    RETURN QUERY SELECT
      v_existing.id,
      v_existing.status,
      v_existing.status IN ('confirmed', 'modified'),
      0,
      TRUE,
      v_existing.priority_score;
    RETURN;
  END IF;

  SELECT * INTO v_channel
  FROM cm_channels
  WHERE account_id = p_account_id AND code = p_channel_code
  LIMIT 1;

  SELECT COUNT(*) INTO v_nights
  FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day');

  v_priority := cm_reservation_priority_score(
    v_nights,
    p_total_amount,
    COALESCE(v_channel.commission_percent, 0),
    COALESCE(v_channel.reliability_level, 0)
  );

  WITH nights AS (
    SELECT d::DATE AS day
    FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day') AS d
  ),
  locked AS (
    SELECT i.*
    FROM cm_inventory_days i
    JOIN nights n ON n.day = i.day
    WHERE i.account_id = p_account_id
      AND i.property_id = p_property_id
      AND i.unit_key = v_unit_key
    FOR UPDATE
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE available_units >= p_quantity)
  INTO v_locked, v_ok
  FROM locked;

  v_should_hold := v_locked = v_nights AND v_ok = v_nights AND p_confirmation_mode = 'confirm';

  IF v_locked <> v_nights OR v_ok <> v_nights THEN
    INSERT INTO cm_reservations (
      account_id, property_id, unit_key, channel_id, channel_code, external_booking_id,
      idempotency_key, guest_name, check_in_date, check_out_date, quantity,
      status, rejection_reason, priority_score, total_amount, commission_percent,
      channel_reliability_level, guest_type, raw_payload
    )
    VALUES (
      p_account_id, p_property_id, v_unit_key, v_channel.id, p_channel_code, p_external_booking_id,
      p_idempotency_key, COALESCE(NULLIF(p_guest_name, ''), 'Гость'), p_check_in_date, p_check_out_date,
      p_quantity, 'conflict', 'no_availability', v_priority, p_total_amount,
      v_channel.commission_percent, v_channel.reliability_level, p_guest_type,
      COALESCE(p_raw_payload, '{}'::jsonb)
    )
    RETURNING * INTO v_res;

    INSERT INTO cm_channel_sync_logs (
      account_id, channel_id, direction, status, message, request_json, response_json
    )
    VALUES (
      p_account_id,
      v_channel.id,
      'inbound',
      'skipped',
      'no_availability',
      COALESCE(p_raw_payload, '{}'::jsonb),
      jsonb_build_object('reservation_id', v_res.id)
    );

    RETURN QUERY SELECT v_res.id, v_res.status, FALSE, 0, FALSE, v_res.priority_score;
    RETURN;
  END IF;

  INSERT INTO cm_reservations (
    account_id, property_id, unit_key, channel_id, channel_code, external_booking_id,
    idempotency_key, guest_name, check_in_date, check_out_date, quantity, status,
    priority_score, total_amount, commission_percent, channel_reliability_level, guest_type, raw_payload
  )
  VALUES (
    p_account_id, p_property_id, v_unit_key, v_channel.id, p_channel_code, p_external_booking_id,
    p_idempotency_key, COALESCE(NULLIF(p_guest_name, ''), 'Гость'), p_check_in_date, p_check_out_date,
    p_quantity, CASE WHEN v_should_hold THEN 'confirmed' ELSE 'pending' END,
    v_priority, p_total_amount, v_channel.commission_percent, v_channel.reliability_level, p_guest_type,
    COALESCE(p_raw_payload, '{}'::jsonb)
  )
  RETURNING * INTO v_res;

  IF v_should_hold THEN
    UPDATE cm_inventory_days
    SET booked_units = booked_units + p_quantity,
        updated_at = NOW()
    WHERE account_id = p_account_id
      AND property_id = p_property_id
      AND unit_key = v_unit_key
      AND day >= p_check_in_date
      AND day < p_check_out_date;

    INSERT INTO cm_reservation_nights (account_id, reservation_id, property_id, unit_key, day, quantity)
    SELECT p_account_id, v_res.id, p_property_id, v_unit_key, d::DATE, p_quantity
    FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day') AS d;

    v_jobs := cm_enqueue_sync_jobs(
      p_account_id, p_property_id, v_unit_key, p_check_in_date, p_check_out_date, 'reservation_created'
    );
  ELSE
    v_jobs := cm_enqueue_sync_jobs(
      p_account_id, p_property_id, v_unit_key, p_check_in_date, p_check_out_date, 'reservation_shadow_pending'
    );
  END IF;

  RETURN QUERY SELECT v_res.id, v_res.status, v_should_hold, v_jobs, FALSE, v_res.priority_score;
END;
$$;
