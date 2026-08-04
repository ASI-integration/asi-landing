-- Channel Manager Live Core v1: allow initial_sync import runs.
-- Does not apply outbound publishing or real provider credentials.
-- Counters for updated/cancelled/skipped/failed and cursor placeholders
-- live in booking_channel_import_runs.metadata / connection.metadata.

ALTER TABLE public.booking_channel_import_runs
  DROP CONSTRAINT IF EXISTS booking_channel_import_runs_type_check;

ALTER TABLE public.booking_channel_import_runs
  ADD CONSTRAINT booking_channel_import_runs_type_check
    CHECK (import_type IN (
      'full',
      'objects',
      'bookings',
      'calendar',
      'pricing',
      'availability',
      'manual_snapshot',
      'initial_sync'
    ));
