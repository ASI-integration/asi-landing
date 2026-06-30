-- Booking Lifecycle Gates v1.
-- Unified internal booking lifecycle state. Provider-ready only; no payment/OkiDoki/MVD external calls.

CREATE TABLE IF NOT EXISTS public.booking_lifecycle_gates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   TEXT        NOT NULL,
  gate_key     TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending',
  source       TEXT        NOT NULL DEFAULT 'system',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reason       TEXT,
  note         TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT booking_lifecycle_gates_key_check
    CHECK (gate_key IN (
      'booking_received',
      'guest_data_requested',
      'guest_data_completed',
      'documents_requested',
      'documents_received',
      'documents_verified',
      'contract_prepared',
      'contract_sent',
      'contract_signed',
      'deposit_requested',
      'deposit_received',
      'mvd_report_prepared',
      'mvd_report_submitted',
      'cleaning_scheduled',
      'linen_scheduled',
      'inspection_scheduled',
      'maintenance_required',
      'maintenance_resolved',
      'property_ready',
      'checkin_instructions_sent',
      'guest_checked_in',
      'guest_checked_out',
      'post_checkout_inspection_done',
      'deposit_return_ready',
      'booking_closed'
    )),

  CONSTRAINT booking_lifecycle_gates_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed')),

  CONSTRAINT booking_lifecycle_gates_source_check
    CHECK (source IN ('system', 'admin', 'guest', 'cleaner', 'master', 'integration')),

  CONSTRAINT booking_lifecycle_gates_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_lifecycle_gates_unique
  ON public.booking_lifecycle_gates (booking_id, gate_key);

CREATE INDEX IF NOT EXISTS idx_booking_lifecycle_gates_booking_status
  ON public.booking_lifecycle_gates (booking_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_lifecycle_exceptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   TEXT        NOT NULL,
  gate_key     TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'open',
  reason       TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'system',
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,

  CONSTRAINT booking_lifecycle_exceptions_status_check
    CHECK (status IN ('open', 'resolved')),

  CONSTRAINT booking_lifecycle_exceptions_source_check
    CHECK (source IN ('system', 'admin', 'guest', 'cleaner', 'master', 'integration')),

  CONSTRAINT booking_lifecycle_exceptions_gate_check
    CHECK (gate_key IN (
      'booking_received',
      'guest_data_requested',
      'guest_data_completed',
      'documents_requested',
      'documents_received',
      'documents_verified',
      'contract_prepared',
      'contract_sent',
      'contract_signed',
      'deposit_requested',
      'deposit_received',
      'mvd_report_prepared',
      'mvd_report_submitted',
      'cleaning_scheduled',
      'linen_scheduled',
      'inspection_scheduled',
      'maintenance_required',
      'maintenance_resolved',
      'property_ready',
      'checkin_instructions_sent',
      'guest_checked_in',
      'guest_checked_out',
      'post_checkout_inspection_done',
      'deposit_return_ready',
      'booking_closed'
    )),

  CONSTRAINT booking_lifecycle_exceptions_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_lifecycle_exceptions_unique
  ON public.booking_lifecycle_exceptions (booking_id, gate_key)
;

CREATE INDEX IF NOT EXISTS idx_booking_lifecycle_exceptions_booking_status
  ON public.booking_lifecycle_exceptions (booking_id, status, updated_at DESC);

ALTER TABLE public.booking_lifecycle_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_lifecycle_exceptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_lifecycle_gates FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_lifecycle_exceptions FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_lifecycle_gates TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_lifecycle_exceptions TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_lifecycle_gates;
CREATE POLICY "service_role_full_access"
  ON public.booking_lifecycle_gates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_lifecycle_exceptions;
CREATE POLICY "service_role_full_access"
  ON public.booking_lifecycle_exceptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
