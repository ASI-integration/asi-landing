-- Channel manager MVP: central inventory, atomic reservations, channel sync queue.
-- Existing public.channels is used by communication accounts, so this module uses cm_* tables.

CREATE TABLE IF NOT EXISTS cm_channels (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code          TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  adapter_kind  TEXT        NOT NULL DEFAULT 'mock',
  status        TEXT        NOT NULL DEFAULT 'active',
  settings_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_channels_code_unique UNIQUE (account_id, code),
  CONSTRAINT cm_channels_code_check
    CHECK (code IN ('ostrovok', 'yandex_travel', 'avito_travel', 'sutochno', 'cian', 'manual')),
  CONSTRAINT cm_channels_adapter_kind_check
    CHECK (adapter_kind IN ('mock', 'manual', 'api')),
  CONSTRAINT cm_channels_status_check
    CHECK (status IN ('active', 'disabled', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_cm_channels_account_id
  ON cm_channels(account_id);

CREATE TABLE IF NOT EXISTS cm_channel_listings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id          UUID        NOT NULL REFERENCES cm_channels(id) ON DELETE CASCADE,
  property_id         UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key            TEXT        NOT NULL DEFAULT 'default',
  external_listing_id TEXT        NOT NULL,
  title               TEXT,
  status              TEXT        NOT NULL DEFAULT 'active',
  settings_json       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_channel_listings_unique UNIQUE (channel_id, property_id, unit_key),
  CONSTRAINT cm_channel_listings_status_check CHECK (status IN ('active', 'disabled', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_cm_channel_listings_property_unit
  ON cm_channel_listings(property_id, unit_key);

CREATE TABLE IF NOT EXISTS cm_inventory_days (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id           UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key              TEXT        NOT NULL DEFAULT 'default',
  day                   DATE        NOT NULL,
  total_units           INT         NOT NULL DEFAULT 1,
  booked_units          INT         NOT NULL DEFAULT 0,
  manual_blocked_units  INT         NOT NULL DEFAULT 0,
  available_units       INT         GENERATED ALWAYS AS (
    GREATEST(total_units - booked_units - manual_blocked_units, 0)
  ) STORED,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_inventory_days_unique UNIQUE (account_id, property_id, unit_key, day),
  CONSTRAINT cm_inventory_days_non_negative_check
    CHECK (total_units >= 0 AND booked_units >= 0 AND manual_blocked_units >= 0)
);

CREATE INDEX IF NOT EXISTS idx_cm_inventory_days_property_unit_day
  ON cm_inventory_days(property_id, unit_key, day);

CREATE TABLE IF NOT EXISTS cm_reservations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  property_id          UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key             TEXT        NOT NULL DEFAULT 'default',
  channel_id           UUID        REFERENCES cm_channels(id) ON DELETE SET NULL,
  channel_code         TEXT        NOT NULL DEFAULT 'manual',
  external_booking_id  TEXT,
  idempotency_key      TEXT,
  guest_name           TEXT        NOT NULL DEFAULT 'Гость',
  check_in_date        DATE        NOT NULL,
  check_out_date       DATE        NOT NULL,
  quantity             INT         NOT NULL DEFAULT 1,
  status               TEXT        NOT NULL DEFAULT 'confirmed',
  rejection_reason     TEXT,
  raw_payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_reservations_dates_check CHECK (check_out_date > check_in_date),
  CONSTRAINT cm_reservations_quantity_check CHECK (quantity > 0),
  CONSTRAINT cm_reservations_channel_code_check
    CHECK (channel_code IN ('ostrovok', 'yandex_travel', 'avito_travel', 'sutochno', 'cian', 'manual')),
  CONSTRAINT cm_reservations_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'declined', 'modified'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_reservations_external_unique
  ON cm_reservations(account_id, property_id, channel_code, external_booking_id)
  WHERE external_booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_reservations_idempotency_unique
  ON cm_reservations(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cm_reservations_property_dates
  ON cm_reservations(property_id, check_in_date, check_out_date);

CREATE TABLE IF NOT EXISTS cm_reservation_nights (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reservation_id  UUID        NOT NULL REFERENCES cm_reservations(id) ON DELETE CASCADE,
  property_id     UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key        TEXT        NOT NULL DEFAULT 'default',
  day             DATE        NOT NULL,
  quantity        INT         NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_reservation_nights_unique UNIQUE (reservation_id, day),
  CONSTRAINT cm_reservation_nights_quantity_check CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_cm_reservation_nights_property_day
  ON cm_reservation_nights(property_id, unit_key, day);

CREATE TABLE IF NOT EXISTS cm_channel_sync_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id      UUID        NOT NULL REFERENCES cm_channels(id) ON DELETE CASCADE,
  listing_id      UUID        REFERENCES cm_channel_listings(id) ON DELETE SET NULL,
  property_id     UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_key        TEXT        NOT NULL DEFAULT 'default',
  date_from       DATE        NOT NULL,
  date_to         DATE        NOT NULL,
  reason          TEXT        NOT NULL DEFAULT 'availability_changed',
  status          TEXT        NOT NULL DEFAULT 'queued',
  idempotency_key TEXT        NOT NULL,
  attempt_count   INT         NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_channel_sync_jobs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT cm_channel_sync_jobs_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cm_channel_sync_jobs_status
  ON cm_channel_sync_jobs(account_id, status, created_at);

CREATE TABLE IF NOT EXISTS cm_channel_sync_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_id        UUID        REFERENCES cm_channel_sync_jobs(id) ON DELETE SET NULL,
  channel_id    UUID        REFERENCES cm_channels(id) ON DELETE SET NULL,
  listing_id    UUID        REFERENCES cm_channel_listings(id) ON DELETE SET NULL,
  direction     TEXT        NOT NULL DEFAULT 'outbound',
  status        TEXT        NOT NULL DEFAULT 'ok',
  message       TEXT,
  request_json  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  response_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_channel_sync_logs_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT cm_channel_sync_logs_status_check CHECK (status IN ('ok', 'error', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_cm_channel_sync_logs_job_id
  ON cm_channel_sync_logs(job_id);

CREATE TABLE IF NOT EXISTS cm_channel_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id      UUID        REFERENCES cm_channels(id) ON DELETE SET NULL,
  idempotency_key TEXT        NOT NULL,
  event_type      TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'processed',
  reservation_id  UUID        REFERENCES cm_reservations(id) ON DELETE SET NULL,
  payload_json    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cm_channel_events_unique UNIQUE (account_id, idempotency_key)
);

ALTER TABLE cm_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_channel_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_inventory_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_reservation_nights ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_channel_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_channel_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cm_channel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON cm_channels;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_channel_listings;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_inventory_days;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_reservations;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_reservation_nights;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_channel_sync_jobs;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_channel_sync_logs;
DROP POLICY IF EXISTS "service_role_full_access" ON cm_channel_events;

CREATE POLICY "service_role_full_access" ON cm_channels
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_channel_listings
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_inventory_days
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_reservations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_reservation_nights
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_channel_sync_jobs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_channel_sync_logs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_full_access" ON cm_channel_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

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
    date_from, date_to, reason, idempotency_key
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
    p_account_id::TEXT || ':' || l.id::TEXT || ':' || p_unit_key || ':' ||
      p_date_from::TEXT || ':' || p_date_to::TEXT || ':' || p_reason || ':' ||
      FLOOR(EXTRACT(EPOCH FROM NOW()) / 60)::TEXT
  FROM cm_channel_listings l
  JOIN cm_channels c ON c.id = l.channel_id
  WHERE l.account_id = p_account_id
    AND l.property_id = p_property_id
    AND l.unit_key = p_unit_key
    AND l.status = 'active'
    AND c.status = 'active'
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION cm_set_inventory_day(
  p_account_id UUID,
  p_property_id UUID,
  p_unit_key TEXT,
  p_day DATE,
  p_total_units INT,
  p_manual_blocked_units INT
) RETURNS TABLE (
  inventory_id UUID,
  available_units INT,
  sync_jobs INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row cm_inventory_days%ROWTYPE;
  v_jobs INT := 0;
BEGIN
  IF p_total_units < 0 OR p_manual_blocked_units < 0 THEN
    RAISE EXCEPTION 'invalid_inventory_units';
  END IF;

  INSERT INTO cm_inventory_days (
    account_id, property_id, unit_key, day, total_units, manual_blocked_units, updated_at
  )
  VALUES (
    p_account_id, p_property_id, COALESCE(NULLIF(p_unit_key, ''), 'default'),
    p_day, p_total_units, p_manual_blocked_units, NOW()
  )
  ON CONFLICT (account_id, property_id, unit_key, day)
  DO UPDATE SET
    total_units = EXCLUDED.total_units,
    manual_blocked_units = EXCLUDED.manual_blocked_units,
    updated_at = NOW()
  RETURNING * INTO v_row;

  v_jobs := cm_enqueue_sync_jobs(
    p_account_id,
    p_property_id,
    v_row.unit_key,
    p_day,
    p_day + 1,
    'inventory_changed'
  );

  RETURN QUERY SELECT v_row.id, v_row.available_units, v_jobs;
END;
$$;

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
  p_raw_payload JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  reservation_id UUID,
  reservation_status TEXT,
  available BOOLEAN,
  sync_jobs INT,
  idempotent BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit_key TEXT := COALESCE(NULLIF(p_unit_key, ''), 'default');
  v_channel_id UUID;
  v_existing cm_reservations%ROWTYPE;
  v_nights INT;
  v_locked INT;
  v_ok INT;
  v_res cm_reservations%ROWTYPE;
  v_jobs INT := 0;
BEGIN
  IF p_check_out_date <= p_check_in_date OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'invalid_reservation_dates_or_quantity';
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
    RETURN QUERY SELECT v_existing.id, v_existing.status, v_existing.status = 'confirmed', 0, TRUE;
    RETURN;
  END IF;

  SELECT id INTO v_channel_id
  FROM cm_channels
  WHERE account_id = p_account_id AND code = p_channel_code
  LIMIT 1;

  SELECT COUNT(*) INTO v_nights
  FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day');

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

  IF v_locked <> v_nights OR v_ok <> v_nights THEN
    INSERT INTO cm_reservations (
      account_id, property_id, unit_key, channel_id, channel_code, external_booking_id,
      idempotency_key, guest_name, check_in_date, check_out_date, quantity,
      status, rejection_reason, raw_payload
    )
    VALUES (
      p_account_id, p_property_id, v_unit_key, v_channel_id, p_channel_code, p_external_booking_id,
      p_idempotency_key, COALESCE(NULLIF(p_guest_name, ''), 'Гость'), p_check_in_date, p_check_out_date,
      p_quantity, 'declined', 'insufficient_availability', COALESCE(p_raw_payload, '{}'::jsonb)
    )
    RETURNING * INTO v_res;

    RETURN QUERY SELECT v_res.id, v_res.status, FALSE, 0, FALSE;
    RETURN;
  END IF;

  INSERT INTO cm_reservations (
    account_id, property_id, unit_key, channel_id, channel_code, external_booking_id,
    idempotency_key, guest_name, check_in_date, check_out_date, quantity, status, raw_payload
  )
  VALUES (
    p_account_id, p_property_id, v_unit_key, v_channel_id, p_channel_code, p_external_booking_id,
    p_idempotency_key, COALESCE(NULLIF(p_guest_name, ''), 'Гость'), p_check_in_date, p_check_out_date,
    p_quantity, 'confirmed', COALESCE(p_raw_payload, '{}'::jsonb)
  )
  RETURNING * INTO v_res;

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

  RETURN QUERY SELECT v_res.id, v_res.status, TRUE, v_jobs, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION cm_cancel_reservation(
  p_account_id UUID,
  p_reservation_id UUID
) RETURNS TABLE (
  reservation_id UUID,
  reservation_status TEXT,
  sync_jobs INT,
  idempotent BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_res cm_reservations%ROWTYPE;
  v_jobs INT := 0;
BEGIN
  SELECT * INTO v_res
  FROM cm_reservations
  WHERE id = p_reservation_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;

  IF v_res.status = 'cancelled' THEN
    RETURN QUERY SELECT v_res.id, v_res.status, 0, TRUE;
    RETURN;
  END IF;

  IF v_res.status = 'confirmed' OR v_res.status = 'modified' THEN
    PERFORM 1
    FROM cm_inventory_days i
    JOIN cm_reservation_nights n
      ON n.account_id = i.account_id
     AND n.property_id = i.property_id
     AND n.unit_key = i.unit_key
     AND n.day = i.day
    WHERE n.reservation_id = v_res.id
    FOR UPDATE;

    UPDATE cm_inventory_days i
    SET booked_units = GREATEST(i.booked_units - n.quantity, 0),
        updated_at = NOW()
    FROM cm_reservation_nights n
    WHERE n.reservation_id = v_res.id
      AND n.account_id = i.account_id
      AND n.property_id = i.property_id
      AND n.unit_key = i.unit_key
      AND n.day = i.day;
  END IF;

  UPDATE cm_reservations
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  v_jobs := cm_enqueue_sync_jobs(
    p_account_id, v_res.property_id, v_res.unit_key, v_res.check_in_date, v_res.check_out_date, 'reservation_cancelled'
  );

  RETURN QUERY SELECT v_res.id, v_res.status, v_jobs, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION cm_modify_reservation_dates(
  p_account_id UUID,
  p_reservation_id UUID,
  p_check_in_date DATE,
  p_check_out_date DATE
) RETURNS TABLE (
  reservation_id UUID,
  reservation_status TEXT,
  available BOOLEAN,
  sync_jobs INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_res cm_reservations%ROWTYPE;
  v_old_from DATE;
  v_old_to DATE;
  v_nights INT;
  v_locked INT;
  v_ok INT;
  v_jobs INT := 0;
BEGIN
  IF p_check_out_date <= p_check_in_date THEN
    RAISE EXCEPTION 'invalid_reservation_dates';
  END IF;

  SELECT * INTO v_res
  FROM cm_reservations
  WHERE id = p_reservation_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found';
  END IF;

  v_old_from := v_res.check_in_date;
  v_old_to := v_res.check_out_date;

  IF v_res.status NOT IN ('confirmed', 'modified') THEN
    UPDATE cm_reservations
    SET check_in_date = p_check_in_date,
        check_out_date = p_check_out_date,
        updated_at = NOW()
    WHERE id = v_res.id
    RETURNING * INTO v_res;
    RETURN QUERY SELECT v_res.id, v_res.status, FALSE, 0;
    RETURN;
  END IF;

  UPDATE cm_inventory_days i
  SET booked_units = GREATEST(i.booked_units - n.quantity, 0),
      updated_at = NOW()
  FROM cm_reservation_nights n
  WHERE n.reservation_id = v_res.id
    AND n.account_id = i.account_id
    AND n.property_id = i.property_id
    AND n.unit_key = i.unit_key
    AND n.day = i.day;

  SELECT COUNT(*) INTO v_nights
  FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day');

  WITH nights AS (
    SELECT d::DATE AS day
    FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day') AS d
  ),
  locked AS (
    SELECT i.*
    FROM cm_inventory_days i
    JOIN nights n ON n.day = i.day
    WHERE i.account_id = p_account_id
      AND i.property_id = v_res.property_id
      AND i.unit_key = v_res.unit_key
    FOR UPDATE
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE available_units >= v_res.quantity)
  INTO v_locked, v_ok
  FROM locked;

  IF v_locked <> v_nights OR v_ok <> v_nights THEN
    UPDATE cm_inventory_days i
    SET booked_units = i.booked_units + n.quantity,
        updated_at = NOW()
    FROM cm_reservation_nights n
    WHERE n.reservation_id = v_res.id
      AND n.account_id = i.account_id
      AND n.property_id = i.property_id
      AND n.unit_key = i.unit_key
      AND n.day = i.day;

    RETURN QUERY SELECT v_res.id, v_res.status, FALSE, 0;
    RETURN;
  END IF;

  DELETE FROM cm_reservation_nights WHERE reservation_id = v_res.id;

  UPDATE cm_inventory_days
  SET booked_units = booked_units + v_res.quantity,
      updated_at = NOW()
  WHERE account_id = p_account_id
    AND property_id = v_res.property_id
    AND unit_key = v_res.unit_key
    AND day >= p_check_in_date
    AND day < p_check_out_date;

  INSERT INTO cm_reservation_nights (account_id, reservation_id, property_id, unit_key, day, quantity)
  SELECT p_account_id, v_res.id, v_res.property_id, v_res.unit_key, d::DATE, v_res.quantity
  FROM generate_series(p_check_in_date, p_check_out_date - 1, INTERVAL '1 day') AS d;

  UPDATE cm_reservations
  SET check_in_date = p_check_in_date,
      check_out_date = p_check_out_date,
      status = 'modified',
      updated_at = NOW()
  WHERE id = v_res.id
  RETURNING * INTO v_res;

  v_jobs := cm_enqueue_sync_jobs(
    p_account_id,
    v_res.property_id,
    v_res.unit_key,
    LEAST(v_old_from, p_check_in_date),
    GREATEST(v_old_to, p_check_out_date),
    'reservation_modified'
  );

  RETURN QUERY SELECT v_res.id, v_res.status, TRUE, v_jobs;
END;
$$;
