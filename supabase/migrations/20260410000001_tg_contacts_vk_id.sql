-- Migration: add vk_id to tg_contacts for VK channel identity
-- Apply before deploying VK adapter (channels/vk.ts)
-- Rolled back by: ALTER TABLE tg_contacts DROP COLUMN IF EXISTS vk_id;

ALTER TABLE tg_contacts
  ADD COLUMN IF NOT EXISTS vk_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_tg_contacts_vk_id ON tg_contacts (vk_id);

COMMENT ON COLUMN tg_contacts.vk_id IS
  'VK user ID (from_id from VK Callback API message_new payload)';
