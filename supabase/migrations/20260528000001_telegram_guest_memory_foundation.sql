-- Telegram guest long-term memory foundation.
--
-- Supabase CLI is not available in this workspace, so this migration was added
-- manually using the existing timestamped migration convention.

CREATE TABLE IF NOT EXISTS tg_conversation_sessions (
  chat_id BIGINT PRIMARY KEY,
  guest_id TEXT,
  property_id TEXT,
  status TEXT NOT NULL DEFAULT 'inquiry',
  status_updated_at TIMESTAMPTZ,
  conversation_context_v1 JSONB NOT NULL DEFAULT '{}'::jsonb,
  guest_history_context_v1 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_property_knowledge (
  property_id TEXT PRIMARY KEY,
  location TEXT,
  check_in_time TEXT,
  check_out_time TEXT,
  wifi_name TEXT,
  wifi_password TEXT,
  wifi_notes TEXT,
  checkin_instructions TEXT,
  door_code_notes TEXT,
  access_notes TEXT,
  parking_rules TEXT,
  parking_paid_or_free TEXT,
  parking_location_notes TEXT,
  quiet_hours TEXT,
  house_rules TEXT,
  heating_notes TEXT,
  emergency_contact_notes TEXT,
  checkout_notes TEXT,
  late_checkout_policy TEXT,
  early_checkin_policy TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tg_property_knowledge
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS check_in_time TEXT,
  ADD COLUMN IF NOT EXISTS check_out_time TEXT,
  ADD COLUMN IF NOT EXISTS wifi_name TEXT,
  ADD COLUMN IF NOT EXISTS wifi_password TEXT,
  ADD COLUMN IF NOT EXISTS wifi_notes TEXT,
  ADD COLUMN IF NOT EXISTS checkin_instructions TEXT,
  ADD COLUMN IF NOT EXISTS door_code_notes TEXT,
  ADD COLUMN IF NOT EXISTS access_notes TEXT,
  ADD COLUMN IF NOT EXISTS parking_rules TEXT,
  ADD COLUMN IF NOT EXISTS parking_paid_or_free TEXT,
  ADD COLUMN IF NOT EXISTS parking_location_notes TEXT,
  ADD COLUMN IF NOT EXISTS quiet_hours TEXT,
  ADD COLUMN IF NOT EXISTS house_rules TEXT,
  ADD COLUMN IF NOT EXISTS heating_notes TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_notes TEXT,
  ADD COLUMN IF NOT EXISTS checkout_notes TEXT,
  ADD COLUMN IF NOT EXISTS late_checkout_policy TEXT,
  ADD COLUMN IF NOT EXISTS early_checkin_policy TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS tg_guest_identities (
  guest_id TEXT PRIMARY KEY,
  telegram_chat_id BIGINT,
  phone TEXT,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  display_name TEXT,
  stays_count INT NOT NULL DEFAULT 0,
  trust_status TEXT NOT NULL DEFAULT 'normal'
    CHECK (trust_status IN ('normal', 'trusted', 'suspicious')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_guest_reservations (
  id TEXT PRIMARY KEY,
  booking_id TEXT,
  property_id TEXT,
  guest_id TEXT,
  guest_name TEXT,
  phone TEXT,
  guest_phone TEXT,
  chat_id BIGINT,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'confirmed',
  access_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tg_guest_identities
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS stays_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trust_status TEXT NOT NULL DEFAULT 'normal'
    CHECK (trust_status IN ('normal', 'trusted', 'suspicious')),
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE tg_guest_reservations
  ADD COLUMN IF NOT EXISTS booking_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS guest_phone TEXT,
  ADD COLUMN IF NOT EXISTS access_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS tg_guest_profiles (
  guest_id TEXT PRIMARY KEY,
  display_name TEXT,
  phone TEXT,
  stays_count INT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  trust_status TEXT NOT NULL DEFAULT 'normal'
    CHECK (trust_status IN ('normal', 'trusted', 'suspicious')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_suspicious_users (
  id BIGSERIAL PRIMARY KEY,
  telegram_chat_id BIGINT,
  phone TEXT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tg_suspicious_users_has_identifier
    CHECK (telegram_chat_id IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_tg_guest_identities_chat_id
  ON tg_guest_identities (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_guest_identities_phone
  ON tg_guest_identities (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_booking_id
  ON tg_guest_reservations (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_phone
  ON tg_guest_reservations (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_guest_phone
  ON tg_guest_reservations (guest_phone)
  WHERE guest_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_guest_profiles_phone
  ON tg_guest_profiles (phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_suspicious_users_chat_id
  ON tg_suspicious_users (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tg_suspicious_users_phone
  ON tg_suspicious_users (phone)
  WHERE phone IS NOT NULL;

ALTER TABLE tg_guest_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tg_suspicious_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON tg_guest_profiles;
CREATE POLICY "service_role_full_access"
  ON tg_guest_profiles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_full_access" ON tg_suspicious_users;
CREATE POLICY "service_role_full_access"
  ON tg_suspicious_users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Mock portfolio seed: 11 properties, fake reservations, returning guests, suspicious users.
INSERT INTO tg_property_knowledge (property_id, location, check_in_time, check_out_time, wifi_name, wifi_password, door_code_notes, access_notes)
VALUES
  ('mock-prop-01', 'Невский 24', '15:00', '12:00', 'ASI-Nevsky24', 'mock-wifi-01', 'mock-door-code-01', 'mock access notes 01'),
  ('mock-prop-02', 'Литейный 12', '15:00', '12:00', 'ASI-Liteyny12', 'mock-wifi-02', 'mock-door-code-02', 'mock access notes 02'),
  ('mock-prop-03', 'Тверская 8', '15:00', '12:00', 'ASI-Tverskaya8', 'mock-wifi-03', 'mock-door-code-03', 'mock access notes 03'),
  ('mock-prop-04', 'Мойка 5', '15:00', '12:00', 'ASI-Moyka5', 'mock-wifi-04', 'mock-door-code-04', 'mock access notes 04'),
  ('mock-prop-05', 'Садовая 17', '15:00', '12:00', 'ASI-Sadovaya17', 'mock-wifi-05', 'mock-door-code-05', 'mock access notes 05'),
  ('mock-prop-06', 'Рубинштейна 3', '15:00', '12:00', 'ASI-Rubin3', 'mock-wifi-06', 'mock-door-code-06', 'mock access notes 06'),
  ('mock-prop-07', 'Арбат 21', '15:00', '12:00', 'ASI-Arbat21', 'mock-wifi-07', 'mock-door-code-07', 'mock access notes 07'),
  ('mock-prop-08', 'Петровка 6', '15:00', '12:00', 'ASI-Petrovka6', 'mock-wifi-08', 'mock-door-code-08', 'mock access notes 08'),
  ('mock-prop-09', 'Бауманская 11', '15:00', '12:00', 'ASI-Baum11', 'mock-wifi-09', 'mock-door-code-09', 'mock access notes 09'),
  ('mock-prop-10', 'Казанская 4', '15:00', '12:00', 'ASI-Kazan4', 'mock-wifi-10', 'mock-door-code-10', 'mock access notes 10'),
  ('mock-prop-11', 'Марата 30', '15:00', '12:00', 'ASI-Marata30', 'mock-wifi-11', 'mock-door-code-11', 'mock access notes 11')
ON CONFLICT (property_id) DO NOTHING;

INSERT INTO tg_guest_profiles (guest_id, display_name, phone, stays_count, trust_status, last_seen_at)
VALUES
  ('mock-guest-01', 'Анна Иванова', '79990000001', 3, 'trusted', now() - interval '20 days'),
  ('mock-guest-02', 'Илья Петров', '79990000002', 2, 'normal', now() - interval '10 days'),
  ('mock-guest-03', 'Мария Смирнова', '79990000003', 5, 'trusted', now() - interval '3 days')
ON CONFLICT (guest_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    phone = EXCLUDED.phone,
    stays_count = EXCLUDED.stays_count,
    trust_status = EXCLUDED.trust_status,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();

INSERT INTO tg_guest_identities (guest_id, telegram_chat_id, first_name, last_name, display_name, phone, stays_count, trust_status, last_seen_at)
VALUES
  ('mock-guest-01', 910001, 'Анна', 'Иванова', 'Анна Иванова', '79990000001', 3, 'trusted', now() - interval '20 days'),
  ('mock-guest-02', 910002, 'Илья', 'Петров', 'Илья Петров', '79990000002', 2, 'normal', now() - interval '10 days'),
  ('mock-guest-03', 910003, 'Мария', 'Смирнова', 'Мария Смирнова', '79990000003', 5, 'trusted', now() - interval '3 days')
ON CONFLICT DO NOTHING;

INSERT INTO tg_guest_reservations (id, booking_id, property_id, guest_id, guest_name, phone, guest_phone, chat_id, check_in, check_out, status)
VALUES
  ('mock-res-01', 'BK-ASI-001', 'mock-prop-01', 'mock-guest-01', 'Анна Иванова', '79990000001', '79990000001', 910001, now() - interval '1 day', now() + interval '2 days', 'confirmed'),
  ('mock-res-02', 'BK-ASI-002', 'mock-prop-02', 'mock-guest-02', 'Илья Петров', '79990000002', '79990000002', 910002, now() + interval '1 day', now() + interval '5 days', 'confirmed'),
  ('mock-res-03', 'BK-ASI-003', 'mock-prop-03', 'mock-guest-03', 'Мария Смирнова', '79990000003', '79990000003', 910003, now() - interval '2 days', now() + interval '1 day', 'confirmed'),
  ('mock-res-04', 'BK-ASI-004', 'mock-prop-04', NULL, 'Новый Гость', '79990000004', '79990000004', NULL, now() + interval '2 days', now() + interval '4 days', 'confirmed'),
  ('mock-res-05', 'BK-ASI-005', 'mock-prop-05', NULL, 'Гость Проверка', '79990000005', '79990000005', NULL, now() + interval '3 days', now() + interval '6 days', 'confirmed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tg_suspicious_users (telegram_chat_id, phone, reason)
VALUES
  (919001, NULL, 'mock suspicious repeated wrong booking access requests'),
  (NULL, '79990000999', 'mock suspicious wrong phone for access requests')
ON CONFLICT DO NOTHING;
