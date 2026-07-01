-- Channel Manager Provider Onboarding v1 reuses the existing connection table.
-- Only the status contract changes; no credentials or provider secrets are stored.

ALTER TABLE public.booking_channel_manager_connections
  DROP CONSTRAINT IF EXISTS booking_channel_manager_connections_status_check;

ALTER TABLE public.booking_channel_manager_connections
  ALTER COLUMN status SET DEFAULT 'not_started';

ALTER TABLE public.booking_channel_manager_connections
  ADD CONSTRAINT booking_channel_manager_connections_status_check
  CHECK (status IN (
    'not_started',
    'provider_selected',
    'account_required',
    'access_requested',
    'access_received',
    'operator_review',
    'import_ready',
    'manual_snapshot_available',
    'pilot_activation_pending',
    'connected_placeholder',
    'blocked',
    -- Legacy values remain readable while existing records progress through v1.
    'not_requested',
    'requested',
    'credential_ref_pending',
    'connected',
    'import_failed',
    'disconnected'
  ));

COMMENT ON COLUMN public.booking_channel_manager_connections.status IS
  'Provider onboarding state. connected_placeholder means onboarding is complete; real provider API sync is still inactive.';
