-- Booking Ops Intake / Readiness Gate v1.
-- Additive intake fields on booking_ops_records; service-role only.

ALTER TABLE public.booking_ops_records
  ADD COLUMN IF NOT EXISTS guest_count INTEGER,
  ADD COLUMN IF NOT EXISTS payment_status TEXT,
  ADD COLUMN IF NOT EXISTS document_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS document_collected BOOLEAN,
  ADD COLUMN IF NOT EXISTS document_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS document_notes TEXT,
  ADD COLUMN IF NOT EXISTS contract_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS contract_provider TEXT,
  ADD COLUMN IF NOT EXISTS contract_intake_status TEXT,
  ADD COLUMN IF NOT EXISTS contract_link TEXT,
  ADD COLUMN IF NOT EXISTS contract_notes TEXT,
  ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS deposit_intake_status TEXT,
  ADD COLUMN IF NOT EXISTS deposit_payment_method TEXT,
  ADD COLUMN IF NOT EXISTS deposit_notes TEXT,
  ADD COLUMN IF NOT EXISTS mvd_required BOOLEAN,
  ADD COLUMN IF NOT EXISTS mvd_data_status TEXT,
  ADD COLUMN IF NOT EXISTS mvd_confirmation_link TEXT,
  ADD COLUMN IF NOT EXISTS mvd_notes TEXT;

ALTER TABLE public.booking_ops_records
  DROP CONSTRAINT IF EXISTS booking_ops_records_document_verification_status_check;

ALTER TABLE public.booking_ops_records
  ADD CONSTRAINT booking_ops_records_document_verification_status_check
    CHECK (
      document_verification_status IS NULL
      OR document_verification_status IN ('missing', 'uploaded', 'verified', 'rejected')
    );

ALTER TABLE public.booking_ops_records
  DROP CONSTRAINT IF EXISTS booking_ops_records_contract_provider_check;

ALTER TABLE public.booking_ops_records
  ADD CONSTRAINT booking_ops_records_contract_provider_check
    CHECK (
      contract_provider IS NULL
      OR contract_provider IN ('manual', 'okidoki', 'none')
    );

ALTER TABLE public.booking_ops_records
  DROP CONSTRAINT IF EXISTS booking_ops_records_contract_intake_status_check;

ALTER TABLE public.booking_ops_records
  ADD CONSTRAINT booking_ops_records_contract_intake_status_check
    CHECK (
      contract_intake_status IS NULL
      OR contract_intake_status IN ('not_required', 'missing', 'prepared', 'sent', 'signed')
    );

ALTER TABLE public.booking_ops_records
  DROP CONSTRAINT IF EXISTS booking_ops_records_deposit_intake_status_check;

ALTER TABLE public.booking_ops_records
  ADD CONSTRAINT booking_ops_records_deposit_intake_status_check
    CHECK (
      deposit_intake_status IS NULL
      OR deposit_intake_status IN (
        'not_required',
        'missing',
        'requested',
        'received',
        'held',
        'returned',
        'issue'
      )
    );

ALTER TABLE public.booking_ops_records
  DROP CONSTRAINT IF EXISTS booking_ops_records_mvd_data_status_check;

ALTER TABLE public.booking_ops_records
  ADD CONSTRAINT booking_ops_records_mvd_data_status_check
    CHECK (
      mvd_data_status IS NULL
      OR mvd_data_status IN (
        'not_required',
        'missing',
        'collected',
        'prepared',
        'submitted',
        'confirmed'
      )
    );
