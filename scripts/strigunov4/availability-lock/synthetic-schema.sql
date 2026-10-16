-- Synthetic structural fixture only: no source rows, archive or credentials.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.properties(id uuid PRIMARY KEY, account_id uuid NOT NULL);
CREATE TABLE public.booking_property_setup_profiles(id uuid PRIMARY KEY, property_id text NOT NULL);
CREATE TABLE public.booking_ops_records(
 id uuid PRIMARY KEY, account_id text, property_id text, check_in_at timestamptz, check_out_at timestamptz,
 availability_status text, overbooking_risk_status text, availability_hold_id uuid, availability_summary jsonb, updated_at timestamptz
);
CREATE TABLE public.booking_availability_holds(
 id uuid PRIMARY KEY, account_id text, property_setup_id uuid, property_id text, booking_id uuid,
 source text, status text, date_from date, date_to date, nights integer, hold_expires_at timestamptz,
 conflict_status text, conflict_summary jsonb, safe_summary text, metadata jsonb, idempotency_key text,
 UNIQUE(account_id,idempotency_key)
);
CREATE TABLE public.booking_availability_blocks(
 id uuid PRIMARY KEY, account_id text, property_id text, status text, date_from date, date_to date
);
CREATE TABLE public.booking_overbooking_conflict_checks(
 id uuid PRIMARY KEY, account_id text, property_setup_id uuid, property_id text, booking_id uuid, hold_id uuid,
 check_type text, status text, requested_date_from date, requested_date_to date,
 conflicts jsonb, blockers jsonb, safe_summary text
);
CREATE TABLE public.booking_channel_imported_bookings(
 id uuid PRIMARY KEY, connection_id uuid, external_object_id text, status text,
 checkin_date date, checkout_date date, matched_booking_id uuid
);
CREATE TABLE public.booking_channel_imported_objects(
 connection_id uuid, external_object_id text, matched_property_id text
);
CREATE TABLE public.booking_channel_calendar_snapshots(
 id uuid PRIMARY KEY, connection_id uuid, external_object_id text, availability_status text, date date
);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
INSERT INTO public.properties(id,account_id) VALUES
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
INSERT INTO public.booking_property_setup_profiles(id,property_id) VALUES
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222');
