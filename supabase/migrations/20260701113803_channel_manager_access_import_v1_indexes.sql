-- Cover Channel Manager v1 foreign keys used by cleanup and reconciliation.

CREATE INDEX IF NOT EXISTS idx_booking_channel_manager_connections_owner_setup
  ON public.booking_channel_manager_connections (owner_setup_id)
  WHERE owner_setup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_objects_import_run
  ON public.booking_channel_imported_objects (import_run_id)
  WHERE import_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_objects_property_setup
  ON public.booking_channel_imported_objects (matched_property_setup_id)
  WHERE matched_property_setup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_bookings_import_run
  ON public.booking_channel_imported_bookings (import_run_id)
  WHERE import_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_bookings_booking
  ON public.booking_channel_imported_bookings (matched_booking_id)
  WHERE matched_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_channel_imported_bookings_property_setup
  ON public.booking_channel_imported_bookings (matched_property_setup_id)
  WHERE matched_property_setup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_channel_calendar_import_run
  ON public.booking_channel_calendar_snapshots (import_run_id)
  WHERE import_run_id IS NOT NULL;
