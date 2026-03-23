-- Persistent store for operational (guest) payment records.
-- Required for getPaymentByTransactionId() cold-start Supabase fallback.
--
-- Run via:  supabase db push  (with linked project)
-- Or paste directly into: Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS operational_payments (
  id                     TEXT PRIMARY KEY,
  provider               TEXT NOT NULL,
  provider_transaction_id TEXT,
  chat_id                TEXT,
  reservation_id         TEXT,
  property_id            TEXT,
  guest_id               TEXT,
  service_type           TEXT,
  amount                 NUMERIC NOT NULL,
  currency               TEXT NOT NULL,
  status                 TEXT NOT NULL,
  payment_url            TEXT,
  expires_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL,
  updated_at             TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_payments_tx_id
  ON operational_payments (provider_transaction_id);

CREATE INDEX IF NOT EXISTS idx_op_payments_chat_status
  ON operational_payments (chat_id, status);
