-- Channel Manager Live Core v1: initial_sync import type + atomic running-run guard.
-- Idempotent. Does not apply outbound publishing or real provider credentials.
-- Counters / cursors / diagnostic lease live in metadata jsonb.

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

-- At most one running initial_sync per connection (atomic execution guard).
CREATE UNIQUE INDEX IF NOT EXISTS booking_channel_import_runs_one_running_initial_sync
  ON public.booking_channel_import_runs (connection_id)
  WHERE import_type = 'initial_sync' AND status = 'running';
