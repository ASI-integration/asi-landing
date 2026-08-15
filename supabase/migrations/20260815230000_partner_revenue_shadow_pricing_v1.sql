-- Partner Revenue Intelligence & Shadow Pricing v1.
-- Additive, service-role-only evidence. No price mutation or provider call exists here.

ALTER TABLE public.partner_property_bindings
  ADD CONSTRAINT partner_property_bindings_account_partner_id_key
  UNIQUE (account_id, partner_account_binding_id, id);

CREATE TABLE public.partner_revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  partner_property_binding_id UUID NOT NULL,
  external_event_id TEXT NOT NULL CHECK (char_length(external_event_id) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'revenue.observation.recorded', 'pricing.shadow.requested', 'pricing.recommendation.feedback'
  )),
  event_fingerprint TEXT NOT NULL CHECK (event_fingerprint ~ '^[0-9a-f]{64}$'),
  audit_ref TEXT NOT NULL UNIQUE CHECK (audit_ref ~ '^prv_[A-Za-z0-9_-]{32,96}$'),
  response JSONB CHECK (response IS NULL OR octet_length(response::text) <= 65536),
  error_code TEXT CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT partner_revenue_events_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_revenue_events_property_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id)
    REFERENCES public.partner_property_bindings(account_id, partner_account_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_revenue_events_identity_key
    UNIQUE (partner_account_binding_id, external_event_id),
  CONSTRAINT partner_revenue_events_state_check CHECK (
    (processed_at IS NULL AND response IS NULL AND error_code IS NULL)
    OR (processed_at IS NOT NULL AND ((response IS NOT NULL) <> (error_code IS NOT NULL)))
  ),
  CONSTRAINT partner_revenue_events_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_revenue_events_scope_id_key
    UNIQUE (account_id, partner_account_binding_id, partner_property_binding_id, id)
);

CREATE TABLE public.partner_revenue_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  partner_property_binding_id UUID NOT NULL,
  property_id UUID NOT NULL,
  source_event_id UUID NOT NULL,
  public_observation_ref TEXT NOT NULL UNIQUE CHECK (public_observation_ref ~ '^obs_[A-Za-z0-9_-]{32,96}$'),
  stay_date DATE NOT NULL,
  current_price NUMERIC(14,2) NOT NULL CHECK (current_price >= 0),
  available_inventory INTEGER NOT NULL CHECK (available_inventory BETWEEN 0 AND 100000),
  sold_inventory INTEGER NOT NULL CHECK (sold_inventory BETWEEN 0 AND available_inventory),
  realized_room_revenue NUMERIC(14,2) NOT NULL CHECK (realized_room_revenue >= 0),
  booking_lead_days INTEGER CHECK (booking_lead_days BETWEEN 0 AND 3650),
  bookings_created INTEGER CHECK (bookings_created BETWEEN 0 AND 100000),
  cancellations INTEGER CHECK (cancellations BETWEEN 0 AND 100000),
  min_stay INTEGER CHECK (min_stay BETWEEN 1 AND 3650),
  closed_to_arrival BOOLEAN,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source TEXT NOT NULL DEFAULT 'partner_supplied' CHECK (source IN ('partner_supplied', 'synthetic_demo')),
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_revenue_observations_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_revenue_observations_property_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id)
    REFERENCES public.partner_property_bindings(account_id, partner_account_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_revenue_observations_property_fk
    FOREIGN KEY (account_id, property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_revenue_observations_event_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id, source_event_id)
    REFERENCES public.partner_revenue_events(account_id, partner_account_binding_id, partner_property_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_revenue_observations_account_id_id_key
    UNIQUE (account_id, partner_account_binding_id, partner_property_binding_id, id),
  CONSTRAINT partner_revenue_observations_night_key
    UNIQUE (partner_account_binding_id, partner_property_binding_id, stay_date, source)
);

CREATE TABLE public.partner_shadow_pricing_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  partner_property_binding_id UUID NOT NULL,
  property_id UUID NOT NULL,
  pricing_profile_id UUID NOT NULL REFERENCES public.booking_pricing_profiles(id) ON DELETE RESTRICT,
  source_event_id UUID NOT NULL,
  observation_id UUID NOT NULL,
  public_recommendation_ref TEXT NOT NULL UNIQUE CHECK (public_recommendation_ref ~ '^prc_[A-Za-z0-9_-]{32,96}$'),
  stay_date DATE NOT NULL,
  current_price NUMERIC(14,2) NOT NULL CHECK (current_price >= 0),
  recommended_price NUMERIC(14,2) NOT NULL CHECK (recommended_price >= 0),
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('low', 'medium', 'high')),
  strategy TEXT NOT NULL CHECK (char_length(strategy) BETWEEN 1 AND 80),
  reason_codes JSONB NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array' AND octet_length(reason_codes::text) <= 4096),
  adjustment_reasons JSONB NOT NULL CHECK (jsonb_typeof(adjustment_reasons) = 'array' AND octet_length(adjustment_reasons::text) <= 16384),
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode = 'shadow'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_shadow_recommendations_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_shadow_recommendations_property_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id)
    REFERENCES public.partner_property_bindings(account_id, partner_account_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_shadow_recommendations_property_fk
    FOREIGN KEY (account_id, property_id)
    REFERENCES public.properties(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_shadow_recommendations_event_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id, source_event_id)
    REFERENCES public.partner_revenue_events(account_id, partner_account_binding_id, partner_property_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_shadow_recommendations_observation_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id, observation_id)
    REFERENCES public.partner_revenue_observations(account_id, partner_account_binding_id, partner_property_binding_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_shadow_recommendations_event_date_key UNIQUE (source_event_id, stay_date),
  CONSTRAINT partner_shadow_recommendations_account_id_id_key UNIQUE (account_id, id),
  CONSTRAINT partner_shadow_recommendations_scope_id_key
    UNIQUE (account_id, partner_account_binding_id, partner_property_binding_id, id)
);

CREATE TABLE public.partner_pricing_recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  partner_account_binding_id UUID NOT NULL,
  partner_property_binding_id UUID NOT NULL,
  recommendation_id UUID NOT NULL,
  source_event_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'ignored')),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code ~ '^[a-z0-9_:-]{1,80}$'),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_pricing_feedback_account_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id)
    REFERENCES public.partner_account_bindings(account_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_pricing_feedback_property_binding_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id)
    REFERENCES public.partner_property_bindings(account_id, partner_account_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_pricing_feedback_recommendation_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id, recommendation_id)
    REFERENCES public.partner_shadow_pricing_recommendations(account_id, partner_account_binding_id, partner_property_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_pricing_feedback_event_fk
    FOREIGN KEY (account_id, partner_account_binding_id, partner_property_binding_id, source_event_id)
    REFERENCES public.partner_revenue_events(account_id, partner_account_binding_id, partner_property_binding_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_pricing_feedback_event_key UNIQUE (source_event_id)
);

CREATE INDEX idx_partner_revenue_observations_property_date
  ON public.partner_revenue_observations (account_id, property_id, stay_date);
CREATE INDEX idx_partner_shadow_recommendations_property_date
  ON public.partner_shadow_pricing_recommendations (account_id, property_id, stay_date);
CREATE INDEX idx_partner_pricing_feedback_recommendation
  ON public.partner_pricing_recommendation_feedback (account_id, recommendation_id, recorded_at DESC);

ALTER TABLE public.partner_revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_revenue_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_revenue_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_revenue_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_shadow_pricing_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_shadow_pricing_recommendations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_pricing_recommendation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_pricing_recommendation_feedback FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_revenue_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_revenue_observations FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_shadow_pricing_recommendations FROM anon, authenticated;
REVOKE ALL ON TABLE public.partner_pricing_recommendation_feedback FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.partner_revenue_events,
  public.partner_revenue_observations,
  public.partner_shadow_pricing_recommendations,
  public.partner_pricing_recommendation_feedback
TO service_role;

COMMENT ON TABLE public.partner_revenue_observations IS
  'Partner-supplied observed nightly facts; never counterfactual revenue.';
COMMENT ON TABLE public.partner_shadow_pricing_recommendations IS
  'Advisory shadow evidence only. It cannot mutate a tariff grid, final price, OTA, or provider.';
