-- Booking/object memory layer for Telegram guest agent (directions, Wi-Fi, parking, checkout).
-- Extends tg_property_knowledge and tg_guest_reservations with operator-facing aliases.

ALTER TABLE tg_property_knowledge
  ADD COLUMN IF NOT EXISTS object_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS directions_text TEXT,
  ADD COLUMN IF NOT EXISTS parking_text TEXT,
  ADD COLUMN IF NOT EXISTS check_in_text TEXT,
  ADD COLUMN IF NOT EXISTS house_rules_text TEXT;

ALTER TABLE tg_guest_reservations
  ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS access_verified BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_chat_id
  ON tg_guest_reservations (chat_id)
  WHERE chat_id IS NOT NULL;

-- Local / live test fixture: one property + one booking linked to Telegram chat 920001.
INSERT INTO tg_property_knowledge (
  property_id,
  object_name,
  address,
  location,
  directions_text,
  parking_text,
  check_in_text,
  check_out_time,
  house_rules_text,
  wifi_name,
  wifi_password,
  checkin_instructions,
  door_code_notes,
  parking_rules,
  house_rules
)
VALUES (
  'test-prop-tg-live',
  'Тестовая квартира ASI',
  'Санкт-Петербург, Невский проспект, 24',
  'Невский 24',
  'Вход со двора, домофон ASI24, лифт на 3 этаж, квартира 12.',
  'Парковка во дворе бесплатная для гостей. Въезд с ул. Малая Морская.',
  'Заезд с 15:00. Ключ в сейфе у входа — код пришлём после проверки брони.',
  '12:00',
  'Тишина после 22:00. Курение запрещено.',
  'ASI-Nevsky24-Guest',
  'test-wifi-nevsky24',
  'Заезд с 15:00. Ключ в сейфе у входа.',
  'Код домофона 4829* — только после проверки брони.',
  'Парковка во дворе бесплатная для гостей.',
  'Тишина после 22:00. Курение запрещено.'
)
ON CONFLICT (property_id) DO UPDATE
SET object_name = EXCLUDED.object_name,
    address = EXCLUDED.address,
    location = EXCLUDED.location,
    directions_text = EXCLUDED.directions_text,
    parking_text = EXCLUDED.parking_text,
    check_in_text = EXCLUDED.check_in_text,
    check_out_time = EXCLUDED.check_out_time,
    house_rules_text = EXCLUDED.house_rules_text,
    wifi_name = EXCLUDED.wifi_name,
    wifi_password = EXCLUDED.wifi_password,
    checkin_instructions = EXCLUDED.checkin_instructions,
    door_code_notes = EXCLUDED.door_code_notes,
    parking_rules = EXCLUDED.parking_rules,
    house_rules = EXCLUDED.house_rules,
    updated_at = now();

INSERT INTO tg_guest_identities (guest_id, telegram_chat_id, first_name, display_name, phone, stays_count, trust_status, last_seen_at)
VALUES (
  'test-guest-tg-live',
  920001,
  'Тест',
  'Тестовый Гость',
  '79991234567',
  1,
  'trusted',
  now()
)
ON CONFLICT (guest_id) DO UPDATE
SET telegram_chat_id = EXCLUDED.telegram_chat_id,
    phone = EXCLUDED.phone,
    display_name = EXCLUDED.display_name,
    updated_at = now();

INSERT INTO tg_guest_reservations (
  id,
  booking_id,
  property_id,
  guest_id,
  guest_name,
  phone,
  guest_phone,
  chat_id,
  check_in,
  check_out,
  status,
  access_verified,
  access_verified_at
)
VALUES (
  'test-res-tg-live',
  'BK-TEST-TG-001',
  'test-prop-tg-live',
  'test-guest-tg-live',
  'Тестовый Гость',
  '79991234567',
  '79991234567',
  920001,
  now() - interval '1 day',
  now() + interval '2 days',
  'confirmed',
  true,
  now()
)
ON CONFLICT (id) DO UPDATE
SET booking_id = EXCLUDED.booking_id,
    property_id = EXCLUDED.property_id,
    guest_id = EXCLUDED.guest_id,
    guest_name = EXCLUDED.guest_name,
    phone = EXCLUDED.phone,
    guest_phone = EXCLUDED.guest_phone,
    chat_id = EXCLUDED.chat_id,
    check_in = EXCLUDED.check_in,
    check_out = EXCLUDED.check_out,
    status = EXCLUDED.status,
    access_verified = EXCLUDED.access_verified,
    access_verified_at = EXCLUDED.access_verified_at,
    updated_at = now();
