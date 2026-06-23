-- Pilot Readiness v1: communication modes, booking intake fields, object passport extras.

ALTER TABLE tg_property_knowledge
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS booking_channels TEXT,
  ADD COLUMN IF NOT EXISTS photos_deferred BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pilot_acceptance_marker TEXT;

ALTER TABLE tg_property_knowledge
  DROP CONSTRAINT IF EXISTS tg_property_knowledge_communication_autopilot_check;

ALTER TABLE tg_property_knowledge
  ADD CONSTRAINT tg_property_knowledge_communication_autopilot_check
  CHECK (communication_autopilot IN ('disabled', 'manual', 'enabled'));

ALTER TABLE tg_guest_reservations
  ADD COLUMN IF NOT EXISTS reservation_ref TEXT,
  ADD COLUMN IF NOT EXISTS booking_channel TEXT,
  ADD COLUMN IF NOT EXISTS guest_contact TEXT,
  ADD COLUMN IF NOT EXISTS pilot_acceptance_marker TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_guest_reservations_reservation_ref
  ON tg_guest_reservations (reservation_ref)
  WHERE reservation_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_property_knowledge_pilot_marker
  ON tg_property_knowledge (pilot_acceptance_marker)
  WHERE pilot_acceptance_marker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_pilot_marker
  ON tg_guest_reservations (pilot_acceptance_marker)
  WHERE pilot_acceptance_marker IS NOT NULL;
