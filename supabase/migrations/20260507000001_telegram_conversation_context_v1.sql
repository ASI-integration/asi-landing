-- Durable Telegram operational conversation memory.
--
-- conversation_context_v1 stores short-term, restart-safe session context:
-- current object/booking, active operational case, pending clarification,
-- last clarified details, and handoff state.
--
-- guest_history_context_v1 is intentionally separate. It is a DB-backed/DB-ready
-- home for long-term repeat-guest history derived from the same conversation,
-- without mixing it into the active operational case.

ALTER TABLE tg_conversation_sessions
  ADD COLUMN IF NOT EXISTS conversation_context_v1 JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS guest_history_context_v1 JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tg_conv_sess_context_property_id
  ON tg_conversation_sessions ((conversation_context_v1 -> 'current_object' ->> 'property_id'))
  WHERE conversation_context_v1 ? 'current_object';

CREATE INDEX IF NOT EXISTS idx_tg_conv_sess_context_reservation_id
  ON tg_conversation_sessions ((conversation_context_v1 -> 'current_booking' ->> 'reservation_id'))
  WHERE conversation_context_v1 ? 'current_booking';

CREATE INDEX IF NOT EXISTS idx_tg_conv_sess_guest_history_last_seen
  ON tg_conversation_sessions ((guest_history_context_v1 ->> 'last_seen_at'))
  WHERE guest_history_context_v1 ? 'last_seen_at';
