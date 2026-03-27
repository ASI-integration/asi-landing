-- Property template columns for guest-facing message customisation.
--
-- Extends tg_property_knowledge so operators can set per-property message
-- templates via /api/admin/upsert-property-templates without SQL edits.
--
-- All ADD COLUMN ... IF NOT EXISTS — safe to re-run.

ALTER TABLE tg_property_knowledge
  ADD COLUMN IF NOT EXISTS pre_checkin_template    TEXT,
  ADD COLUMN IF NOT EXISTS checkout_template       TEXT,
  ADD COLUMN IF NOT EXISTS followup_template       TEXT,
  ADD COLUMN IF NOT EXISTS escalation_contact_text TEXT;
