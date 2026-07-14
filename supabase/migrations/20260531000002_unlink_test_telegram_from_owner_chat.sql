-- Unlink test/demo Telegram fixtures from the real owner chat (931919812).
-- Synthetic HTTP/live tests must use TELEGRAM_TEST_CHAT_ID (e.g. 920001), not owner chat.

ALTER TABLE public.tg_guest_reservations
  ADD COLUMN IF NOT EXISTS reservation_ref TEXT;

UPDATE public.tg_guest_reservations
SET chat_id = NULL,
    updated_at = now()
WHERE chat_id = 931919812
  AND (
    reservation_ref LIKE 'TEST-%'
    OR reservation_ref LIKE 'BOOKING-TEST-%'
    OR reservation_ref LIKE 'LIVE-TEST-%'
    OR reservation_ref = 'BOOKING-001'
    OR guest_id = 'tg_931919812'
    OR COALESCE(note, '') ILIKE '%test%'
    OR COALESCE(note, '') ILIKE '%e2e%'
    OR id LIKE 'test-%'
    OR property_id LIKE 'test-%'
    OR property_id LIKE 'mock-%'
  );

UPDATE public.tg_guest_identities
SET telegram_chat_id = NULL,
    updated_at = now()
WHERE telegram_chat_id = 931919812
  AND guest_id LIKE 'test-%';

UPDATE public.tg_guest_reservations
SET chat_id = 920001,
    updated_at = now()
WHERE id = 'test-res-tg-live'
  AND chat_id = 931919812;

UPDATE public.tg_guest_identities
SET telegram_chat_id = 920001,
    updated_at = now()
WHERE guest_id = 'test-guest-tg-live'
  AND telegram_chat_id = 931919812;
