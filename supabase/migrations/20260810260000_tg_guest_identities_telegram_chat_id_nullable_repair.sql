-- Guest identity compatibility repair: telegram_chat_id must be optional.
-- Production drift made this column NOT NULL with no default, while lifecycle
-- synthetic fixtures intentionally create identities before a Telegram chat id
-- exists. Restore nullable semantics without changing existing values.

ALTER TABLE public.tg_guest_identities
  ALTER COLUMN telegram_chat_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
