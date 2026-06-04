-- Object Knowledge SSOT foundation for live property facts.
-- No OTA/photo/channel-manager sync here: only entry/event/audit tables.

CREATE TABLE IF NOT EXISTS object_knowledge_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id TEXT NOT NULL,
  property_id TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'access',
    'directions',
    'waste',
    'parking',
    'wifi',
    'baby_crib',
    'sleeping_places',
    'amenities',
    'house_rules',
    'checkout',
    'maintenance',
    'media',
    'listing',
    'operations'
  )),
  key TEXT NOT NULL,
  value_text TEXT,
  value_json JSONB,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN (
    'guest_public',
    'guest_after_booking_verified',
    'operator_only',
    'internal',
    'sensitive'
  )),
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN (
    'normal',
    'personal_data',
    'access_code',
    'password',
    'private_link'
  )),
  source_type TEXT NOT NULL DEFAULT 'unknown' CHECK (source_type IN (
    'owner',
    'manager',
    'cleaner',
    'operator',
    'guest_report',
    'ota',
    'photo',
    'system',
    'unknown'
  )),
  source_ref TEXT,
  confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  last_verified_at TIMESTAMPTZ,
  stale_after_days INTEGER CHECK (stale_after_days IS NULL OR stale_after_days > 0),
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT object_knowledge_entries_key_live_unique UNIQUE (object_id, key)
);

CREATE INDEX IF NOT EXISTS idx_object_knowledge_entries_property_key
  ON object_knowledge_entries (property_id, key)
  WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_object_knowledge_entries_category
  ON object_knowledge_entries (category);

CREATE TABLE IF NOT EXISTS object_knowledge_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id TEXT NOT NULL,
  property_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'inventory_updated',
    'amenity_updated',
    'waste_info_updated',
    'access_info_updated',
    'media_updated',
    'listing_updated',
    'maintenance_issue_created',
    'cleaner_checklist_updated',
    'guest_feedback_received'
  )),
  affected_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  old_value_summary TEXT,
  new_value_summary TEXT,
  source_type TEXT NOT NULL DEFAULT 'unknown' CHECK (source_type IN (
    'owner',
    'manager',
    'cleaner',
    'operator',
    'guest_report',
    'ota',
    'photo',
    'system',
    'unknown'
  )),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requires_listing_sync BOOLEAN NOT NULL DEFAULT false,
  requires_guest_bot_update BOOLEAN NOT NULL DEFAULT false,
  requires_operator_review BOOLEAN NOT NULL DEFAULT false,
  requires_photo_update BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_object_knowledge_events_object_created
  ON object_knowledge_events (object_id, created_at DESC);

CREATE TABLE IF NOT EXISTS object_knowledge_reply_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL,
  object_id_masked TEXT,
  intent TEXT NOT NULL,
  knowledge_key TEXT NOT NULL,
  knowledge_found BOOLEAN NOT NULL,
  knowledge_status TEXT NOT NULL CHECK (knowledge_status IN (
    'found',
    'missing',
    'stale',
    'low_confidence',
    'blocked_sensitive'
  )),
  source_type TEXT CHECK (source_type IN (
    'owner',
    'manager',
    'cleaner',
    'operator',
    'guest_report',
    'ota',
    'photo',
    'system',
    'unknown'
  )),
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  last_verified_at TIMESTAMPTZ,
  reply_source TEXT NOT NULL CHECK (reply_source IN ('object_knowledge', 'fallback', 'operator_review')),
  guest_reply_redacted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_object_knowledge_reply_audit_message
  ON object_knowledge_reply_audit (message_id);

ALTER TABLE object_knowledge_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_knowledge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_knowledge_reply_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON object_knowledge_entries;
CREATE POLICY "service_role_full_access"
  ON object_knowledge_entries
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_full_access" ON object_knowledge_events;
CREATE POLICY "service_role_full_access"
  ON object_knowledge_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_full_access" ON object_knowledge_reply_audit;
CREATE POLICY "service_role_full_access"
  ON object_knowledge_reply_audit
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON TABLE object_knowledge_entries FROM anon, authenticated;
REVOKE ALL ON TABLE object_knowledge_events FROM anon, authenticated;
REVOKE ALL ON TABLE object_knowledge_reply_audit FROM anon, authenticated;
