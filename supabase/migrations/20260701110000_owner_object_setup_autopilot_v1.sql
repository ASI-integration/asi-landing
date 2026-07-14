-- Owner/Object Setup Autopilot v1: owner and property setup profiles, assets, communication intents.

CREATE TABLE IF NOT EXISTS public.booking_owner_setup_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id text,
  owner_id text,
  owner_name text,
  owner_contact_ref text,
  status text NOT NULL DEFAULT 'new',
  pilot_group text,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  readiness_score integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  public_token text,
  token_created_at timestamptz,
  token_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_owner_setup_profiles_status_check
    CHECK (status IN (
      'new',
      'instruction_sent',
      'data_collection_started',
      'data_incomplete',
      'data_ready',
      'access_requested',
      'access_received',
      'test_object_selected',
      'ready_for_setup',
      'blocked'
    )),
  CONSTRAINT booking_owner_setup_profiles_pilot_group_check
    CHECK (pilot_group IS NULL OR pilot_group IN ('bragin', 'strigunov', 'other')),
  CONSTRAINT booking_owner_setup_profiles_lead_id_unique UNIQUE (lead_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_owner_setup_profiles_status
  ON public.booking_owner_setup_profiles (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_owner_setup_profiles_public_token
  ON public.booking_owner_setup_profiles (public_token)
  WHERE public_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.booking_property_setup_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_setup_id uuid REFERENCES public.booking_owner_setup_profiles(id) ON DELETE CASCADE,
  property_id text,
  lead_id text,
  status text NOT NULL DEFAULT 'new',
  title text,
  address_city text,
  address_area text,
  address_safe_summary text,
  property_type text,
  room_count integer,
  guest_capacity integer,
  checkin_time text,
  checkout_time text,
  wifi_status text NOT NULL DEFAULT 'unknown',
  rules_status text NOT NULL DEFAULT 'missing',
  photos_status text NOT NULL DEFAULT 'missing',
  pricing_status text NOT NULL DEFAULT 'missing',
  channel_access_status text NOT NULL DEFAULT 'not_requested',
  readiness_score integer NOT NULL DEFAULT 0,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_property_setup_profiles_status_check
    CHECK (status IN (
      'new',
      'collecting_data',
      'incomplete',
      'ready_for_review',
      'ready_for_channel_preparation',
      'blocked'
    )),
  CONSTRAINT booking_property_setup_profiles_wifi_status_check
    CHECK (wifi_status IN ('unknown', 'missing', 'provided', 'verified')),
  CONSTRAINT booking_property_setup_profiles_rules_status_check
    CHECK (rules_status IN ('missing', 'partial', 'complete')),
  CONSTRAINT booking_property_setup_profiles_photos_status_check
    CHECK (photos_status IN ('missing', 'partial', 'enough', 'ready')),
  CONSTRAINT booking_property_setup_profiles_pricing_status_check
    CHECK (pricing_status IN ('missing', 'partial', 'ready')),
  CONSTRAINT booking_property_setup_profiles_channel_access_status_check
    CHECK (channel_access_status IN (
      'not_requested',
      'requested',
      'received',
      'invalid',
      'blocked'
    ))
);

CREATE INDEX IF NOT EXISTS idx_booking_property_setup_profiles_owner_setup
  ON public.booking_property_setup_profiles (owner_setup_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_property_setup_profiles_status
  ON public.booking_property_setup_profiles (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_property_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_setup_id uuid NOT NULL REFERENCES public.booking_property_setup_profiles(id) ON DELETE CASCADE,
  asset_type text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  storage_ref text,
  safe_label text,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_property_assets_asset_type_check
    CHECK (asset_type IN ('photo', 'document', 'instruction', 'video', 'other')),
  CONSTRAINT booking_property_assets_status_check
    CHECK (status IN ('uploaded', 'accepted', 'rejected', 'needs_replacement'))
);

CREATE INDEX IF NOT EXISTS idx_booking_property_assets_property_setup
  ON public.booking_property_assets (property_setup_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.booking_owner_setup_communication_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_setup_id uuid NOT NULL REFERENCES public.booking_owner_setup_profiles(id) ON DELETE CASCADE,
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id) ON DELETE SET NULL,
  message_type text NOT NULL,
  channel text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'draft_ready',
  message_text text NOT NULL,
  message_template_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT booking_owner_setup_communication_status_check
    CHECK (status IN ('draft_ready', 'waiting_for_external_input', 'completed', 'superseded', 'cancelled')),
  CONSTRAINT booking_owner_setup_communication_channel_check
    CHECK (channel IN ('telegram', 'email', 'phone', 'internal', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_booking_owner_setup_communication_owner
  ON public.booking_owner_setup_communication_intents (owner_setup_id, updated_at DESC);

ALTER TABLE public.booking_owner_setup_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_property_setup_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_property_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_owner_setup_communication_intents ENABLE ROW LEVEL SECURITY;
