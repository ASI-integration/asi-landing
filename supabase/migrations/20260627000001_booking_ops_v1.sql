-- Guest/Booking Ops v1: operational workflow layer for pre-check-in bookings.
-- Manual-first; automation-ready fields for documents, contract, deposit, MVD, check-in.
-- Service-role only; dashboard accesses via backend APIs.

CREATE TABLE IF NOT EXISTS booking_ops_records (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id               TEXT,
  guest_name               TEXT,
  guest_phone              TEXT,
  guest_email              TEXT,
  guest_telegram           TEXT,
  property_id              TEXT,
  property_label           TEXT,
  ota_source               TEXT,
  check_in_at              TIMESTAMPTZ,
  check_out_at             TIMESTAMPTZ,
  ops_status               TEXT        NOT NULL DEFAULT 'created',
  manual_next_action       TEXT,
  is_blocked               BOOLEAN     NOT NULL DEFAULT FALSE,
  blocker_reason           TEXT,
  documents_status         TEXT        NOT NULL DEFAULT 'not_started',
  contract_status          TEXT        NOT NULL DEFAULT 'not_started',
  deposit_status           TEXT        NOT NULL DEFAULT 'not_started',
  mvd_status               TEXT        NOT NULL DEFAULT 'not_required',
  checkin_readiness_status TEXT        NOT NULL DEFAULT 'not_started',
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_ops_records_ops_status_check
    CHECK (ops_status IN (
      'created',
      'guest_contact_known',
      'documents_requested',
      'documents_received',
      'contract_prepared',
      'contract_sent',
      'contract_signed',
      'deposit_requested',
      'deposit_confirmed',
      'mvd_required',
      'mvd_prepared',
      'mvd_submitted',
      'checkin_instructions_ready',
      'ready_for_checkin',
      'problem_blocked'
    )),

  CONSTRAINT booking_ops_records_documents_status_check
    CHECK (documents_status IN (
      'not_started',
      'requested',
      'received',
      'verified',
      'problem'
    )),

  CONSTRAINT booking_ops_records_contract_status_check
    CHECK (contract_status IN (
      'not_started',
      'prepared',
      'sent',
      'signed',
      'problem'
    )),

  CONSTRAINT booking_ops_records_deposit_status_check
    CHECK (deposit_status IN (
      'not_started',
      'requested',
      'confirmed',
      'problem'
    )),

  CONSTRAINT booking_ops_records_mvd_status_check
    CHECK (mvd_status IN (
      'not_required',
      'required',
      'prepared',
      'submitted',
      'problem'
    )),

  CONSTRAINT booking_ops_records_checkin_readiness_status_check
    CHECK (checkin_readiness_status IN (
      'not_started',
      'in_progress',
      'ready',
      'problem'
    ))
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_records_booking_id
  ON booking_ops_records(booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_ops_records_ops_status
  ON booking_ops_records(ops_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_ops_records_check_in
  on booking_ops_records(check_in_at)
  WHERE check_in_at IS NOT NULL;

ALTER TABLE booking_ops_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON booking_ops_records;

CREATE POLICY "service_role_full_access"
  ON booking_ops_records
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON TABLE public.booking_ops_records FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.booking_ops_records
  TO service_role;

-- After applying this migration, reload PostgREST schema cache if acceptance still reports
-- "Could not find the table ... in the schema cache":
--   NOTIFY pgrst, 'reload schema';
