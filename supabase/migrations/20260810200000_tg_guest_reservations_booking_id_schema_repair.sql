-- Restore the historical tg_guest_reservations.booking_id schema contract.
--
-- Production drift was detected by Guest Lifecycle Production Acceptance v1:
-- public.tg_guest_reservations exists without booking_id, while the repository
-- schema and synthetic acceptance harness both require this nullable TEXT
-- column. Keep this repair additive and data-preserving.

ALTER TABLE public.tg_guest_reservations
  ADD COLUMN IF NOT EXISTS booking_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_booking_id
  ON public.tg_guest_reservations (booking_id)
  WHERE booking_id IS NOT NULL;
