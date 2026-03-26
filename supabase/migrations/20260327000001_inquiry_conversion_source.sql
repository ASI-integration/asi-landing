-- Add conversion_source to tg_inquiry_flows.
--
-- Distinguishes operator-confirmed reservation linkage from automatic inference,
-- fulfilling the requirement that "conversion must only happen from a real bridge
-- action or grounded linkage."
--
-- Possible values:
--   'operator_confirmed'        — linked via POST /api/admin/link-reservation
--   'grounded_reservation_match' — matched by reservation.ts with confidence ≥ 1.0
-- NULL = pre-migration rows or source not recorded.

ALTER TABLE tg_inquiry_flows
  ADD COLUMN IF NOT EXISTS conversion_source TEXT;
