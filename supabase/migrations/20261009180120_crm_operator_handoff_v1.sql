-- SOURCE ONLY. No staff/policy seeds; no migration application or live worker authorized.
-- Identity is public.users.id, never applicant role, email text, contact notes or referral.
CREATE TABLE public.crm_operator_handoff_staff (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE RESTRICT,
  safe_alias text NOT NULL UNIQUE CHECK (safe_alias ~ '^op-[a-f0-9]{12}$'),
  active boolean NOT NULL DEFAULT false,
  can_assign boolean NOT NULL DEFAULT false,
  can_ack boolean NOT NULL DEFAULT false,
  valid_until timestamptz NOT NULL,
  available_until timestamptz NOT NULL,
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approval_sha256 text NOT NULL CHECK (approval_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.crm_operator_handoff_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  ack_seconds integer NOT NULL CHECK (ack_seconds BETWEEN 60 AND 86400),
  backup_ack_seconds integer NOT NULL CHECK (backup_ack_seconds BETWEEN 60 AND 86400),
  valid_until timestamptz NOT NULL,
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approval_sha256 text NOT NULL CHECK (approval_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE public.crm_operator_handoffs (
  contact_id uuid PRIMARY KEY REFERENCES public.crm_contacts(id) ON DELETE RESTRICT,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  assignment_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
  assignee_id uuid REFERENCES public.crm_operator_handoff_staff(user_id) ON DELETE RESTRICT,
  backup_id uuid REFERENCES public.crm_operator_handoff_staff(user_id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'needs_operator'
    CHECK (state IN ('needs_operator','assigned','acknowledged','escalated','manual_overdue','closed')),
  reason_code text NOT NULL DEFAULT 'unassigned'
    CHECK (reason_code IN ('unassigned','assigned','acknowledged','declined','backup_unavailable',
      'backup_takeover','manual_overdue','reassigned','resolved','withdrawn')),
  assigned_at timestamptz,
  ack_due_at timestamptz,
  acknowledged_at timestamptz,
  escalated_at timestamptz,
  closed_at timestamptz,
  last_transition_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (backup_id IS NULL OR (assignee_id IS NOT NULL AND backup_id <> assignee_id)),
  CHECK (state NOT IN ('assigned','escalated','acknowledged') OR
    (assignee_id IS NOT NULL AND assigned_at IS NOT NULL AND ack_due_at IS NOT NULL AND ack_due_at >= assigned_at)),
  CHECK (state <> 'acknowledged' OR acknowledged_at IS NOT NULL),
  CHECK (acknowledged_at IS NULL OR state IN ('acknowledged','closed')),
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);
CREATE TABLE public.crm_operator_handoff_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.crm_operator_handoffs(contact_id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('assign','ack','decline','escalate','reassign','close')),
  generation_before integer NOT NULL CHECK (generation_before >= 0),
  generation_after integer NOT NULL CHECK (generation_after = generation_before + 1),
  idempotency_key uuid NOT NULL,
  request_fingerprint jsonb NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('assigned','acknowledged','declined',
    'backup_unavailable','backup_takeover','manual_overdue','reassigned','resolved','withdrawn')),
  policy_approval_sha256 text NOT NULL CHECK (policy_approval_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (contact_id, idempotency_key),
  UNIQUE (contact_id, generation_after),
  CHECK ((action = 'escalate') = (actor_id IS NULL))
);
CREATE INDEX crm_operator_handoffs_due_idx ON public.crm_operator_handoffs(ack_due_at, contact_id)
  WHERE state IN ('assigned','escalated');
-- No application role may provision/extend staffing or owner approval.
ALTER TABLE public.crm_operator_handoff_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoff_staff FORCE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoff_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoff_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoff_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_operator_handoff_events FORCE ROW LEVEL SECURITY;
CREATE POLICY handoff_staff_service ON public.crm_operator_handoff_staff TO service_role USING (true);
CREATE POLICY handoff_policy_service ON public.crm_operator_handoff_policy TO service_role USING (true);
CREATE POLICY handoff_ledger_service ON public.crm_operator_handoffs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY handoff_events_service ON public.crm_operator_handoff_events TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.crm_operator_handoff_staff, public.crm_operator_handoff_policy,
  public.crm_operator_handoffs, public.crm_operator_handoff_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.crm_operator_handoff_staff, public.crm_operator_handoff_policy TO service_role;
-- FOR SHARE needs UPDATE privilege on at least one column. An identity-preserving
-- trigger below permits the lock privilege but denies every roster/policy write.
GRANT UPDATE (user_id) ON public.crm_operator_handoff_staff TO service_role;
GRANT UPDATE (singleton) ON public.crm_operator_handoff_policy TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.crm_operator_handoffs TO service_role;
GRANT SELECT, INSERT ON public.crm_operator_handoff_events TO service_role;

CREATE FUNCTION public.crm_operator_handoff_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_IMMUTABLE';
END;
$$;
CREATE TRIGGER handoff_events_immutable BEFORE UPDATE OR DELETE ON public.crm_operator_handoff_events
  FOR EACH ROW EXECUTE FUNCTION public.crm_operator_handoff_immutable_v1();
CREATE TRIGGER handoff_events_no_truncate BEFORE TRUNCATE ON public.crm_operator_handoff_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.crm_operator_handoff_immutable_v1();
CREATE FUNCTION public.crm_operator_handoff_provision_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user IN ('service_role','anon','authenticated') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_PROVISION_OWNER_ONLY';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER handoff_staff_provision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.crm_operator_handoff_staff
  FOR EACH ROW EXECUTE FUNCTION public.crm_operator_handoff_provision_guard_v1();
CREATE TRIGGER handoff_policy_provision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.crm_operator_handoff_policy
  FOR EACH ROW EXECUTE FUNCTION public.crm_operator_handoff_provision_guard_v1();

-- Read-only projection. No notes, names, emails, user UUIDs, nonce or approval material.
CREATE FUNCTION public.crm_operator_handoff_queue_v1(p_contact_ids uuid[]) RETURNS jsonb
-- VOLATILE obtains a fresh snapshot after the transition RPC's writes; the body only SELECTs.
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contactId', c.id, 'status', COALESCE(h.state, 'needs_operator'),
    'generation', COALESCE(h.generation, 0), 'assigneeAlias', a.safe_alias,
    'backupAlias', b.safe_alias, 'assignedAt', h.assigned_at, 'ackDueAt', h.ack_due_at,
    'acknowledgedAt', h.acknowledged_at, 'escalatedAt', h.escalated_at, 'closedAt', h.closed_at,
    'overdue', COALESCE(h.state IN ('assigned','escalated') AND h.ack_due_at <= statement_timestamp(), false),
    'needsOperator', COALESCE(h.state NOT IN ('acknowledged','closed'), true)
      OR (h.state = 'acknowledged' AND NOT COALESCE(a.active AND a.can_ack
        AND a.valid_until > statement_timestamp() AND a.available_until > statement_timestamp(), false)),
    'reasonCode', COALESCE(h.reason_code, 'unassigned')
  ) ORDER BY c.id), '[]'::jsonb)
  FROM public.crm_contacts AS c
  LEFT JOIN public.crm_operator_handoffs AS h ON h.contact_id = c.id
  LEFT JOIN public.crm_operator_handoff_staff AS a ON a.user_id = h.assignee_id
  LEFT JOIN public.crm_operator_handoff_staff AS b ON b.user_id = h.backup_id
  WHERE current_user = 'service_role'
    AND cardinality(p_contact_ids) BETWEEN 1 AND 500
    AND c.id = ANY(p_contact_ids) AND NOT COALESCE(c.crm_archived, false);
$$;

CREATE FUNCTION public.crm_operator_handoff_transition_v1(
  p_contact_id uuid, p_actor_id uuid, p_action text, p_expected_generation integer,
  p_idempotency_key uuid, p_assignee_id uuid DEFAULT NULL, p_backup_id uuid DEFAULT NULL,
  p_reason_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.crm_contacts%ROWTYPE;
  h public.crm_operator_handoffs%ROWTYPE;
  e public.crm_operator_handoff_events%ROWTYPE;
  policy public.crm_operator_handoff_policy%ROWTYPE;
  actor public.crm_operator_handoff_staff%ROWTYPE;
  primary_staff public.crm_operator_handoff_staff%ROWTYPE;
  backup_staff public.crm_operator_handoff_staff%ROWTYPE;
  instant timestamptz;
  deadline timestamptz;
  request jsonb;
  before_generation integer;
BEGIN
  IF current_user <> 'service_role' OR p_contact_id IS NULL OR p_idempotency_key IS NULL
      OR p_expected_generation IS NULL OR p_expected_generation < 0
      OR p_action IS NULL OR p_action NOT IN ('assign','ack','decline','escalate','reassign','close') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_DENIED';
  END IF;
  IF (p_action = 'escalate') IS DISTINCT FROM (p_actor_id IS NULL)
      OR (p_action NOT IN ('assign','reassign') AND (p_assignee_id IS NOT NULL OR p_backup_id IS NOT NULL))
      OR (p_action <> 'close' AND p_reason_code IS NOT NULL)
      OR (p_action = 'close' AND (p_reason_code IS NULL OR p_reason_code NOT IN ('resolved','withdrawn'))) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HANDOFF_INVALID';
  END IF;
  -- Canonical contact lock also serializes first assignment and CRM archive races.
  SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(c.crm_archived, false) OR c.source = 'test' OR c.role = 'guest'
      OR c.status IN ('guest_test','guest_autopilot','testing_communication')
      OR COALESCE(c.name, '') ~* 'wizard\s*acceptance'
      OR COALESCE(c.telegram_username, '') ~* '^wizard_accept'
      OR COALESCE(c.notes, '') ~* '(acceptance_run|wizard_accept|guest_test|guest_autopilot|testing_communication)' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_CONTACT_INELIGIBLE';
  END IF;
  SELECT * INTO h FROM public.crm_operator_handoffs WHERE contact_id = p_contact_id FOR UPDATE;
  -- Same global lock order across contacts; locks prevent concurrent roster revocation.
  PERFORM user_id FROM public.crm_operator_handoff_staff
    WHERE user_id IN (p_actor_id, p_assignee_id, p_backup_id, h.assignee_id, h.backup_id)
    ORDER BY user_id FOR SHARE;
  SELECT * INTO policy FROM public.crm_operator_handoff_policy WHERE singleton FOR SHARE;
  instant := clock_timestamp();
  IF policy.enabled IS DISTINCT FROM true OR policy.valid_until <= instant THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_POLICY_UNAVAILABLE';
  END IF;
  IF p_actor_id IS NOT NULL THEN
    SELECT * INTO actor FROM public.crm_operator_handoff_staff WHERE user_id = p_actor_id;
    IF actor.active IS DISTINCT FROM true OR actor.valid_until <= instant OR actor.available_until <= instant
        OR (p_action IN ('assign','reassign','close') AND actor.can_assign IS DISTINCT FROM true)
        OR (p_action IN ('ack','decline') AND actor.can_ack IS DISTINCT FROM true) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_ACTOR_DENIED';
    END IF;
  END IF;
  IF h.contact_id IS NOT NULL AND instant < h.last_transition_at THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_CLOCK_RECONCILIATION';
  END IF;
  request := jsonb_build_object('action',p_action,'actor',p_actor_id,'generation',p_expected_generation,
    'assignee',p_assignee_id,'backup',p_backup_id,'reason',p_reason_code);
  SELECT * INTO e FROM public.crm_operator_handoff_events
    WHERE contact_id = p_contact_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF e.request_fingerprint IS DISTINCT FROM request OR e.generation_after IS DISTINCT FROM h.generation THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_REPLAY_STALE';
    END IF;
    RETURN jsonb_build_object('replayed',true,'handoff', public.crm_operator_handoff_queue_v1(ARRAY[p_contact_id])->0);
  END IF;
  IF h.contact_id IS NULL THEN
    IF p_action <> 'assign' OR p_expected_generation <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_STALE';
    END IF;
    INSERT INTO public.crm_operator_handoffs(contact_id,last_transition_at)
      VALUES (p_contact_id,instant) RETURNING * INTO h;
  END IF;
  IF h.generation <> p_expected_generation OR h.state = 'closed' THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_STALE';
  END IF;
  before_generation := h.generation;
  IF p_action IN ('assign','reassign') THEN
    IF (p_action = 'assign' AND h.generation <> 0) OR p_assignee_id IS NULL
        OR p_assignee_id = p_backup_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'HANDOFF_INVALID_ASSIGNMENT';
    END IF;
    deadline := instant + make_interval(secs => policy.ack_seconds);
    SELECT * INTO primary_staff FROM public.crm_operator_handoff_staff WHERE user_id = p_assignee_id;
    SELECT * INTO backup_staff FROM public.crm_operator_handoff_staff WHERE user_id = p_backup_id;
    IF primary_staff.active IS DISTINCT FROM true OR primary_staff.can_ack IS DISTINCT FROM true
        OR primary_staff.valid_until < deadline OR primary_staff.available_until < deadline THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_ASSIGNEE_DENIED';
    END IF;
    h.assignee_id := p_assignee_id;
    h.backup_id := NULL;
    h.assigned_at := instant;
    h.ack_due_at := NULL;
    h.acknowledged_at := NULL;
    h.escalated_at := NULL;
    h.state := 'needs_operator';
    h.reason_code := 'backup_unavailable';
    IF backup_staff.active IS TRUE AND backup_staff.can_ack IS TRUE
        AND backup_staff.valid_until >= deadline + make_interval(secs => policy.backup_ack_seconds)
        AND backup_staff.available_until >= deadline + make_interval(secs => policy.backup_ack_seconds)
        AND policy.valid_until >= deadline + make_interval(secs => policy.backup_ack_seconds) THEN
      h.backup_id := p_backup_id;
      h.ack_due_at := deadline;
      h.state := 'assigned';
      h.reason_code := CASE WHEN p_action = 'assign' THEN 'assigned' ELSE 'reassigned' END;
    END IF;
  ELSIF p_action IN ('ack','decline') THEN
    IF h.assignee_id IS DISTINCT FROM p_actor_id OR h.state NOT IN ('assigned','escalated') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_NOT_ASSIGNEE';
    END IF;
    IF h.ack_due_at <= instant THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_ACK_OVERDUE';
    END IF;
    -- Assignment cannot be accepted while its promised backup is already revoked.
    IF p_action = 'ack' AND h.state = 'assigned' THEN
      SELECT * INTO backup_staff FROM public.crm_operator_handoff_staff WHERE user_id = h.backup_id;
      IF backup_staff.active IS DISTINCT FROM true OR backup_staff.can_ack IS DISTINCT FROM true
          OR backup_staff.valid_until <= instant OR backup_staff.available_until <= instant THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'HANDOFF_BACKUP_UNAVAILABLE';
      END IF;
    END IF;
    h.state := CASE WHEN p_action = 'ack' THEN 'acknowledged' ELSE 'needs_operator' END;
    h.reason_code := CASE WHEN p_action = 'ack' THEN 'acknowledged' ELSE 'declined' END;
    h.acknowledged_at := CASE WHEN p_action = 'ack' THEN instant ELSE NULL END;
    IF p_action = 'decline' THEN h.ack_due_at := NULL; END IF;
  ELSIF p_action = 'escalate' THEN
    IF h.state NOT IN ('assigned','escalated') OR h.ack_due_at > instant OR h.ack_due_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_NOT_DUE';
    END IF;
    deadline := instant + make_interval(secs => policy.backup_ack_seconds);
    SELECT * INTO backup_staff FROM public.crm_operator_handoff_staff WHERE user_id = h.backup_id;
    IF h.state = 'assigned' AND backup_staff.active IS TRUE AND backup_staff.can_ack IS TRUE
        AND backup_staff.valid_until >= deadline AND backup_staff.available_until >= deadline
        AND policy.valid_until >= deadline THEN
      h.assignee_id := h.backup_id;
      h.backup_id := NULL;
      h.state := 'escalated';
      h.reason_code := 'backup_takeover';
      h.assigned_at := instant;
      h.ack_due_at := deadline;
      h.escalated_at := instant;
    ELSE
      h.state := 'manual_overdue';
      h.reason_code := 'manual_overdue';
    END IF;
  ELSE
    IF p_reason_code = 'resolved' AND h.state <> 'acknowledged' THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_NOT_ACKNOWLEDGED';
    END IF;
    h.state := 'closed';
    h.reason_code := p_reason_code;
    h.closed_at := instant;
  END IF;
  h.generation := h.generation + 1;
  h.assignment_nonce := gen_random_uuid();
  UPDATE public.crm_operator_handoffs SET
    generation = h.generation, assignment_nonce = h.assignment_nonce,
    assignee_id = h.assignee_id, backup_id = h.backup_id, state = h.state, reason_code = h.reason_code,
    assigned_at = h.assigned_at, ack_due_at = h.ack_due_at, acknowledged_at = h.acknowledged_at,
    escalated_at = h.escalated_at, closed_at = h.closed_at, last_transition_at = instant
    WHERE contact_id = p_contact_id AND generation = before_generation;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'HANDOFF_STALE';
  END IF;
  INSERT INTO public.crm_operator_handoff_events(contact_id,actor_id,action,generation_before,
    generation_after,idempotency_key,request_fingerprint,reason_code,policy_approval_sha256,created_at)
    VALUES (p_contact_id,p_actor_id,p_action,before_generation,h.generation,p_idempotency_key,
      request,h.reason_code,policy.approval_sha256,instant);
  RETURN jsonb_build_object('replayed',false,'handoff', public.crm_operator_handoff_queue_v1(ARRAY[p_contact_id])->0);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_operator_handoff_immutable_v1(),
  public.crm_operator_handoff_provision_guard_v1(),
  public.crm_operator_handoff_queue_v1(uuid[]),
  public.crm_operator_handoff_transition_v1(uuid,uuid,text,integer,uuid,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_operator_handoff_queue_v1(uuid[]),
  public.crm_operator_handoff_transition_v1(uuid,uuid,text,integer,uuid,uuid,uuid,text) TO service_role;
