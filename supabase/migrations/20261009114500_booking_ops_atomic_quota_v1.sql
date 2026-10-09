-- Atomic quota admission; code-only until separately reviewed/applied.
-- No policy/scope activation. UTC quota days. All unknown outcomes remain held.
BEGIN;

CREATE TABLE public.booking_ops_auto_send_quota_mutex (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id),
  generation bigint NOT NULL DEFAULT 0
);
CREATE TABLE public.booking_ops_auto_send_quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL UNIQUE REFERENCES public.booking_ops_communication_deliveries(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  booking_key text NOT NULL CHECK (length(booking_key) > 0),
  guest_key text NOT NULL CHECK (length(guest_key) = 64),
  channel text NOT NULL CHECK (channel IN ('telegram', 'email')),
  recipient_hash text NOT NULL CHECK (length(recipient_hash) = 64),
  idempotency_key text NOT NULL,
  intent_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 64),
  policy_updated_at timestamptz NOT NULL,
  scope_updated_at timestamptz NOT NULL,
  quota_day date NOT NULL,
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'dispatching', 'sent', 'uncertain')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, idempotency_key),
  UNIQUE (account_id, intent_id, channel, recipient_hash)
);
CREATE INDEX booking_ops_quota_booking ON public.booking_ops_auto_send_quota_reservations(account_id, booking_key, quota_day);
CREATE INDEX booking_ops_quota_guest ON public.booking_ops_auto_send_quota_reservations(account_id, guest_key, quota_day);
ALTER TABLE public.booking_ops_auto_send_quota_mutex ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_ops_auto_send_quota_reservations ENABLE ROW LEVEL SECURITY;
-- Service can inspect receipts but cannot fabricate, release or delete reservations.
REVOKE ALL ON public.booking_ops_auto_send_quota_mutex FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.booking_ops_auto_send_quota_reservations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.booking_ops_auto_send_quota_reservations TO service_role;
CREATE POLICY quota_receipt_service_read ON public.booking_ops_auto_send_quota_reservations
  FOR SELECT TO service_role USING (true);

CREATE FUNCTION public.booking_ops_atomic_quota_v1(
  p_phase text, p_delivery_id uuid, p_account_id uuid, p_policy_id uuid,
  p_scope_id uuid, p_recipient text, p_payload_hash text,
  p_reservation_id uuid DEFAULT NULL, p_provider_message_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d public.booking_ops_communication_deliveries%ROWTYPE;
  i public.booking_ops_communication_intents%ROWTYPE;
  b public.booking_ops_records%ROWTYPE;
  pol public.booking_ops_communication_policies%ROWTYPE;
  sc public.booking_ops_communication_auto_send_scopes%ROWTYPE;
  g public.booking_ops_communication_auto_send_scopes%ROWTYPE;
  q public.booking_ops_auto_send_quota_reservations%ROWTYPE;
  day_utc date := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  recipient text;
  v_guest_key text;
  count_used bigint;
BEGIN
  IF p_phase IS NULL OR p_phase NOT IN ('reserve', 'dispatch', 'sent', 'uncertain')
     OR p_account_id IS NULL OR p_delivery_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_invalid_request');
  END IF;
  -- Lock order: global guard, account mutex, delivery, intent, record, property,
  -- policy, narrow scope, reservation. The mutex UPDATE also fences stale
  -- REPEATABLE READ snapshots (serialization failure, never stale count admission).
  SELECT * INTO g FROM public.booking_ops_communication_auto_send_scopes
    WHERE scope_type = 'global' AND account_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'code', 'quota_guard_missing'); END IF;
  INSERT INTO public.booking_ops_auto_send_quota_mutex(account_id) VALUES(p_account_id)
    ON CONFLICT (account_id) DO NOTHING;
  UPDATE public.booking_ops_auto_send_quota_mutex SET generation = generation + 1 WHERE account_id = p_account_id;
  SELECT * INTO d FROM public.booking_ops_communication_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND OR d.account_id IS DISTINCT FROM p_account_id THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_scope_mismatch');
  END IF;
  SELECT * INTO q FROM public.booking_ops_auto_send_quota_reservations WHERE delivery_id = d.id FOR UPDATE;

  -- Completion records evidence, never releases capacity. Revocation must not
  -- prevent recording a provider outcome. Only the previously issued receipt matches.
  IF p_phase IN ('sent', 'uncertain') THEN
    IF q.id IS NULL OR q.id IS DISTINCT FROM p_reservation_id
       OR q.account_id IS DISTINCT FROM p_account_id OR q.state <> 'dispatching' THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'quota_receipt_mismatch');
    END IF;
    UPDATE public.booking_ops_auto_send_quota_reservations
      SET state = p_phase, provider_message_id = CASE WHEN p_phase = 'sent'
        THEN left(p_provider_message_id, 160) ELSE NULL END, updated_at = clock_timestamp()
      WHERE id = q.id;
    RETURN jsonb_build_object('allowed', true, 'phase', p_phase, 'reservation_id', q.id, 'delivery_id', d.id);
  END IF;
  IF g.emergency_stop OR g.actual_send_enabled THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'emergency_stop');
  END IF;
  IF p_phase = 'reserve' AND q.id IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_replay_held');
  END IF;
  IF p_phase = 'dispatch' AND (q.id IS NULL OR q.id IS DISTINCT FROM p_reservation_id OR q.state <> 'held') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_replay_held');
  END IF;
  IF (p_phase = 'reserve' AND d.status NOT IN ('queued', 'dry_run', 'blocked'))
     OR (p_phase = 'dispatch' AND d.status <> 'sending') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_delivery_state');
  END IF;

  SELECT * INTO i FROM public.booking_ops_communication_intents WHERE id = d.communication_intent_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'code', 'quota_intent_missing'); END IF;
  SELECT * INTO b FROM public.booking_ops_records WHERE id = i.booking_ops_record_id FOR SHARE;
  IF NOT FOUND OR b.account_id IS DISTINCT FROM p_account_id::text
     OR NULLIF(btrim(b.booking_id), '') IS NULL
     OR d.booking_id IS DISTINCT FROM b.booking_id OR i.booking_id IS DISTINCT FROM b.booking_id THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_scope_mismatch');
  END IF;
  PERFORM 1 FROM public.properties WHERE id::text = b.property_id AND account_id = p_account_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed', false, 'code', 'quota_scope_mismatch'); END IF;
  -- No metadata-based worker identity. Those roles remain review-only until a
  -- canonical staff/channel binding is available in a separately reviewed change.
  IF i.actor_type <> 'guest' OR d.recipient_role <> 'guest'
     OR d.channel NOT IN ('telegram', 'email') OR d.channel IS DISTINCT FROM i.channel
     OR d.message_type IS DISTINCT FROM i.purpose
     OR i.status NOT IN ('draft_ready', 'waiting_for_external_input') OR i.superseded_at IS NOT NULL
     OR b.is_blocked
     OR (i.metadata->'auto_send_decision'->>'rule_key' LIKE 'operator.%'
       AND i.metadata->'auto_send_decision'->>'decision' IN ('blocked', 'review_required')) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_identity_or_intent_blocked');
  END IF;
  -- Canonical normalized email is the guest quota identity ACROSS channels and
  -- bookings in this account. Missing identity is BLOCK, not a per-booking fallback.
  IF NULLIF(btrim(b.guest_email), '') IS NULL OR b.guest_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_guest_identity_missing');
  END IF;
  v_guest_key := encode(sha256(convert_to(lower(btrim(b.guest_email)), 'UTF8')), 'hex');
  recipient := CASE WHEN d.channel = 'email' THEN lower(btrim(b.guest_email)) ELSE btrim(b.guest_telegram) END;
  IF NULLIF(recipient, '') IS NULL OR p_recipient IS DISTINCT FROM recipient
     OR d.recipient_ref IS DISTINCT FROM recipient
     OR p_payload_hash IS DISTINCT FROM encode(sha256(convert_to(i.message_text, 'UTF8')), 'hex')
     OR NULLIF(d.idempotency_key, '') IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_payload_mismatch');
  END IF;
  -- Re-select winning persisted policy, never trust caller caps/counts/policy claims.
  SELECT * INTO pol FROM public.booking_ops_communication_policies
    WHERE message_type IN (i.purpose, '*') AND channel IN (i.channel, 'any')
      AND ((scope = 'booking' AND scope_ref = b.booking_id)
        OR (scope = 'property' AND scope_ref = b.property_id)
        OR (scope = 'global' AND scope_ref IS NULL))
    ORDER BY CASE scope WHEN 'booking' THEN 40 WHEN 'property' THEN 30 ELSE 10 END DESC,
      (message_type <> '*') DESC, (channel <> 'any') DESC, id
    LIMIT 1 FOR SHARE;
  IF NOT FOUND OR pol.id IS DISTINCT FROM p_policy_id OR NOT pol.auto_send_enabled
     OR NOT pol.actual_send_enabled OR pol.requires_review
     OR (pol.max_auto_sends_per_booking_per_day IS NOT NULL AND pol.max_auto_sends_per_booking_per_day <= 0)
     OR (pol.max_auto_sends_per_guest_per_day IS NOT NULL AND pol.max_auto_sends_per_guest_per_day <= 0) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_policy_blocked');
  END IF;
  SELECT * INTO sc FROM public.booking_ops_communication_auto_send_scopes
    WHERE account_id = p_account_id
      AND ((scope_type = 'booking' AND scope_ref = b.booking_id) OR (scope_type = 'property' AND scope_ref = b.property_id))
    ORDER BY CASE scope_type WHEN 'booking' THEN 50 ELSE 40 END DESC, id LIMIT 1 FOR SHARE;
  IF NOT FOUND OR sc.id IS DISTINCT FROM p_scope_id OR NOT sc.actual_send_enabled
     OR sc.dry_run_only OR sc.emergency_stop
     OR NOT (sc.allowed_channels ? d.channel) OR NOT (sc.allowed_message_types ? d.message_type) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_scope_disabled');
  END IF;
  IF p_phase = 'dispatch' THEN
    IF q.payload_hash IS DISTINCT FROM p_payload_hash OR q.guest_key IS DISTINCT FROM v_guest_key
       OR q.booking_key IS DISTINCT FROM b.booking_id OR q.channel IS DISTINCT FROM d.channel
       OR q.recipient_hash IS DISTINCT FROM encode(sha256(convert_to(recipient, 'UTF8')), 'hex')
       OR q.policy_updated_at IS DISTINCT FROM pol.updated_at
       OR q.scope_updated_at IS DISTINCT FROM sc.updated_at
       OR q.intent_id IS DISTINCT FROM d.communication_intent_id
       OR q.idempotency_key IS DISTINCT FROM d.idempotency_key
       OR q.quota_day <> day_utc THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'quota_snapshot_changed');
    END IF;
    UPDATE public.booking_ops_auto_send_quota_reservations SET state = 'dispatching', updated_at = clock_timestamp() WHERE id = q.id;
    RETURN jsonb_build_object('allowed', true, 'phase', p_phase, 'reservation_id', q.id, 'delivery_id', d.id);
  END IF;
  -- No undercount on rollout: unreconciled legacy outcomes require operator review.
  -- Historical uncertain sends block even across UTC midnight; never recycle them.
  IF EXISTS (SELECT 1 FROM public.booking_ops_communication_deliveries old
    WHERE old.account_id = p_account_id
      AND (old.status IN ('sending', 'failed') OR
        (old.status = 'sent' AND (old.sent_at IS NULL OR (old.sent_at AT TIME ZONE 'UTC')::date = day_utc)))
      AND NOT EXISTS (SELECT 1 FROM public.booking_ops_auto_send_quota_reservations owned WHERE owned.delivery_id = old.id))
    OR EXISTS (SELECT 1 FROM public.booking_ops_communication_auto_send_attempts a
      JOIN public.booking_ops_communication_intents ai ON ai.id = a.communication_intent_id
      JOIN public.booking_ops_records ab ON ab.id = ai.booking_ops_record_id
      WHERE ab.account_id = p_account_id::text AND a.result = 'sent'
        AND (a.created_at AT TIME ZONE 'UTC')::date = day_utc
        AND NOT EXISTS (SELECT 1 FROM public.booking_ops_auto_send_quota_reservations owned WHERE owned.intent_id = ai.id)) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'quota_legacy_reconciliation_required');
  END IF;
  -- Held/uncertain reservations never expire automatically. Sent rows count on
  -- their UTC admission day. Unlimited dimensions skip the cap check (no counters).
  IF pol.max_auto_sends_per_booking_per_day IS NOT NULL THEN
    SELECT count(*) INTO count_used FROM public.booking_ops_auto_send_quota_reservations
      WHERE account_id = p_account_id AND booking_key = b.booking_id
        AND (state <> 'sent' OR quota_day = day_utc);
    IF count_used >= pol.max_auto_sends_per_booking_per_day THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'quota_booking_exhausted');
    END IF;
  END IF;
  IF pol.max_auto_sends_per_guest_per_day IS NOT NULL THEN
    SELECT count(*) INTO count_used FROM public.booking_ops_auto_send_quota_reservations
      WHERE account_id = p_account_id AND guest_key = v_guest_key
        AND (state <> 'sent' OR quota_day = day_utc);
    IF count_used >= pol.max_auto_sends_per_guest_per_day THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'quota_guest_exhausted');
    END IF;
  END IF;
  INSERT INTO public.booking_ops_auto_send_quota_reservations
    (delivery_id, account_id, booking_key, guest_key, channel, recipient_hash, idempotency_key, intent_id, payload_hash, policy_updated_at, scope_updated_at, quota_day)
    VALUES (d.id, p_account_id, b.booking_id, v_guest_key, d.channel,
      encode(sha256(convert_to(recipient, 'UTF8')), 'hex'), d.idempotency_key, i.id, p_payload_hash, pol.updated_at, sc.updated_at, day_utc)
    RETURNING * INTO q;
  UPDATE public.booking_ops_communication_deliveries SET status = 'sending',
    attempt_count = attempt_count + 1, last_attempt_at = clock_timestamp(), updated_at = clock_timestamp(),
    failure_reason = NULL, policy_decision_id = pol.id WHERE id = d.id;
  RETURN jsonb_build_object('allowed', true, 'phase', p_phase, 'reservation_id', q.id, 'delivery_id', d.id);
END;
$$;
REVOKE ALL ON FUNCTION public.booking_ops_atomic_quota_v1(text, uuid, uuid, uuid, uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_ops_atomic_quota_v1(text, uuid, uuid, uuid, uuid, text, text, uuid, text) TO service_role;

-- Prevent an old count-then-send executor from claiming delivery without admission.
CREATE FUNCTION public.booking_ops_quota_delivery_fence_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.booking_ops_auto_send_quota_reservations q WHERE q.delivery_id = OLD.id)
     AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.communication_intent_id IS DISTINCT FROM OLD.communication_intent_id
       OR NEW.booking_id IS DISTINCT FROM OLD.booking_id OR NEW.channel IS DISTINCT FROM OLD.channel
       OR NEW.recipient_ref IS DISTINCT FROM OLD.recipient_ref OR NEW.recipient_role IS DISTINCT FROM OLD.recipient_role
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.message_type IS DISTINCT FROM OLD.message_type) THEN
    RAISE EXCEPTION 'atomic_quota_delivery_identity_immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'sending' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sending') THEN
    IF NOT EXISTS (SELECT 1 FROM public.booking_ops_auto_send_quota_reservations q
      WHERE q.delivery_id = NEW.id AND q.account_id = NEW.account_id AND q.state = 'held') THEN
      RAISE EXCEPTION 'atomic_quota_reservation_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.booking_ops_quota_delivery_fence_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER booking_ops_quota_delivery_fence_v1 BEFORE INSERT OR UPDATE ON public.booking_ops_communication_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.booking_ops_quota_delivery_fence_v1();
COMMIT;
