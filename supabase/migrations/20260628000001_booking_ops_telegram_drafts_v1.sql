-- Telegram Draft Handoff v1 for Booking Ops.
-- Internal only: creates copy-ready drafts and never sends Telegram messages.

CREATE TABLE IF NOT EXISTS public.booking_ops_telegram_drafts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ops_record_id UUID        NOT NULL REFERENCES public.booking_ops_records(id),
  source_booking_id     TEXT,
  telegram_chat_id      BIGINT,
  telegram_target       TEXT,
  action_id             TEXT        NOT NULL,
  message_text          TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'draft',
  created_by            TEXT,
  warning               TEXT,
  metadata              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT booking_ops_telegram_drafts_action_check
    CHECK (action_id IN (
      'request_guest_documents',
      'send_contract',
      'request_deposit',
      'prepare_checkin_instructions'
    )),
  CONSTRAINT booking_ops_telegram_drafts_status_check
    CHECK (status IN ('draft', 'copied', 'sent_manually', 'cancelled', 'failed')),
  CONSTRAINT booking_ops_telegram_drafts_message_check
    CHECK (length(btrim(message_text)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_ops_telegram_drafts_record_created
  ON public.booking_ops_telegram_drafts(booking_ops_record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_ops_telegram_drafts_source_booking
  ON public.booking_ops_telegram_drafts(source_booking_id)
  WHERE source_booking_id IS NOT NULL;

ALTER TABLE public.booking_ops_telegram_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_ops_telegram_drafts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_ops_telegram_drafts TO service_role;

DROP POLICY IF EXISTS "service_role_full_access" ON public.booking_ops_telegram_drafts;
CREATE POLICY "service_role_full_access"
  ON public.booking_ops_telegram_drafts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
