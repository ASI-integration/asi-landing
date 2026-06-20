-- Property timezone + voice policy JSON for Telegram Voice Response Policy v1.

ALTER TABLE tg_property_knowledge
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS voice_policy_json JSONB;
