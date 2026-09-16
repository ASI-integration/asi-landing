-- AO-004 migration only (DO NOT APPLY in this task).
-- YooKassa Payment Readiness v1: durable identity, idempotency, paid_at, owner, metadata.

ALTER TABLE IF EXISTS operational_payments
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_op_payments_provider_tx_unique
  ON operational_payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_op_payments_idempotency_unique
  ON operational_payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_op_payments_owner_status
  ON operational_payments (owner_id, status);

COMMENT ON COLUMN operational_payments.idempotency_key IS
  'Stable create Idempotence-Key for provider createPayment; retries must reuse this value.';
COMMENT ON COLUMN operational_payments.paid_at IS
  'Set only after authoritative provider-confirmed success.';
COMMENT ON COLUMN operational_payments.metadata IS
  'Bounded internal identifiers only — never secrets.';
