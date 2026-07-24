-- ASI Chat -> Runtime Bridge v1.
-- Durable internal queue only. This migration does not invoke Runtime or any external provider.

CREATE TABLE public.asi_runtime_bridge_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 3 AND 100),
  chatgpt_task_id TEXT NOT NULL CHECK (length(chatgpt_task_id) BETWEEN 1 AND 200),
  conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'awaiting_owner', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  recovery_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  runner_id TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  owner_decision JSONB,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key),
  CHECK (
    (status = 'running' AND runner_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR status <> 'running'
  )
);

CREATE TABLE public.asi_runtime_bridge_owner_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.asi_runtime_bridge_tasks(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 3 AND 100),
  task_cycle TEXT NOT NULL CHECK (length(task_cycle) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  decision_id TEXT,
  decision JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  UNIQUE (task_id, task_cycle)
);

CREATE INDEX idx_asi_runtime_bridge_queue
  ON public.asi_runtime_bridge_tasks(status, available_at, created_at, id);
CREATE INDEX idx_asi_runtime_bridge_chat_identity
  ON public.asi_runtime_bridge_tasks(client_id, chatgpt_task_id, conversation_id);
CREATE INDEX idx_asi_runtime_bridge_pending_gates
  ON public.asi_runtime_bridge_owner_gates(client_id, status, created_at);
CREATE UNIQUE INDEX idx_asi_runtime_bridge_owner_decision_once
  ON public.asi_runtime_bridge_owner_gates(client_id, decision_id)
  WHERE decision_id IS NOT NULL;
CREATE UNIQUE INDEX idx_asi_runtime_bridge_single_running
  ON public.asi_runtime_bridge_tasks ((true)) WHERE status = 'running';

CREATE FUNCTION public.submit_asi_runtime_bridge_task(
  p_client_id TEXT,
  p_chatgpt_task_id TEXT,
  p_conversation_id TEXT,
  p_idempotency_key TEXT,
  p_request JSONB,
  p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_task public.asi_runtime_bridge_tasks%ROWTYPE;
  v_deduplicated BOOLEAN := FALSE;
BEGIN
  IF p_client_id IS NULL OR p_chatgpt_task_id IS NULL OR p_conversation_id IS NULL
     OR p_idempotency_key IS NULL OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
     OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_bridge_task';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id || ':' || p_idempotency_key, 0));
  SELECT * INTO v_task
  FROM public.asi_runtime_bridge_tasks
  WHERE client_id = p_client_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_task.request_hash <> p_request_hash
       OR v_task.chatgpt_task_id <> p_chatgpt_task_id
       OR v_task.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    v_deduplicated := TRUE;
  ELSE
    INSERT INTO public.asi_runtime_bridge_tasks(
      client_id, chatgpt_task_id, conversation_id, idempotency_key, request_hash, request
    ) VALUES (
      p_client_id, p_chatgpt_task_id, p_conversation_id, p_idempotency_key, p_request_hash, p_request
    ) RETURNING * INTO v_task;
  END IF;

  RETURN jsonb_build_object(
    'deduplicated', v_deduplicated,
    'task', jsonb_build_object(
      'id', v_task.id,
      'chatgpt_task_id', v_task.chatgpt_task_id,
      'conversation_id', v_task.conversation_id,
      'status', v_task.status,
      'attempt_count', v_task.attempt_count,
      'created_at', v_task.created_at,
      'updated_at', v_task.updated_at
    )
  );
END;
$$;

CREATE FUNCTION public.claim_asi_runtime_bridge_task(
  p_client_id TEXT,
  p_runner_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_task public.asi_runtime_bridge_tasks%ROWTYPE;
  v_token UUID := gen_random_uuid();
BEGIN
  IF p_client_id IS NULL OR p_runner_id IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid_runner_claim';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('asi_runtime_bridge_single_runner', 0));

  WITH expired_gates AS (
    UPDATE public.asi_runtime_bridge_owner_gates
    SET status = 'expired'
    WHERE client_id = p_client_id AND status = 'pending'
      AND (request->>'expiresAt')::timestamptz <= now()
    RETURNING task_id
  )
  UPDATE public.asi_runtime_bridge_tasks
  SET status = 'failed',
      result = jsonb_build_object(
        'schemaVersion', 'asi.runtime.result.v1', 'status', 'failed',
        'summary', 'Owner gate expired.', 'changedFiles', '[]'::jsonb,
        'checks', '[]'::jsonb, 'artifacts', '[]'::jsonb, 'blockers', jsonb_build_array('owner_gate_expired')
      ),
      updated_at = now()
  WHERE id IN (SELECT task_id FROM expired_gates) AND status = 'awaiting_owner';

  UPDATE public.asi_runtime_bridge_tasks
  SET status = 'failed',
      result = jsonb_build_object(
        'schemaVersion', 'asi.runtime.result.v1', 'status', 'failed',
        'summary', 'Runtime recovery attempts exhausted.', 'changedFiles', '[]'::jsonb,
        'checks', '[]'::jsonb, 'artifacts', '[]'::jsonb, 'blockers', jsonb_build_array('crash_recovery_exhausted')
      ),
      runner_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE status = 'running' AND lease_expires_at <= now() AND recovery_count >= 2;

  UPDATE public.asi_runtime_bridge_tasks
  SET status = 'queued', recovery_count = recovery_count + 1,
      runner_id = NULL, lease_token = NULL, lease_expires_at = NULL,
      available_at = now(), updated_at = now()
  WHERE status = 'running' AND lease_expires_at <= now() AND recovery_count < 2;

  SELECT * INTO v_task
  FROM public.asi_runtime_bridge_tasks
  WHERE status = 'running' AND lease_expires_at > now()
  LIMIT 1;
  IF FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_task
  FROM public.asi_runtime_bridge_tasks
  WHERE client_id = p_client_id AND status = 'queued' AND available_at <= now()
  ORDER BY available_at, created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.asi_runtime_bridge_tasks
  SET status = 'running', attempt_count = attempt_count + 1, runner_id = p_runner_id,
      lease_token = v_token, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id = v_task.id
  RETURNING * INTO v_task;

  UPDATE public.asi_runtime_bridge_owner_gates
  SET status = 'consumed', consumed_at = now()
  WHERE task_id = v_task.id AND status = 'approved';

  RETURN jsonb_build_object(
    'taskId', v_task.id, 'chatgptTaskId', v_task.chatgpt_task_id,
    'conversationId', v_task.conversation_id, 'request', v_task.request,
    'ownerDecision', v_task.owner_decision, 'attemptCount', v_task.attempt_count,
    'leaseToken', v_task.lease_token, 'leaseExpiresAt', v_task.lease_expires_at
  );
END;
$$;

CREATE FUNCTION public.heartbeat_asi_runtime_bridge_task(
  p_client_id TEXT,
  p_runner_id TEXT,
  p_task_id UUID,
  p_lease_token UUID,
  p_lease_seconds INTEGER DEFAULT 120
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 900 THEN RETURN FALSE; END IF;
  UPDATE public.asi_runtime_bridge_tasks
  SET lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  WHERE id = p_task_id AND client_id = p_client_id AND status = 'running'
    AND runner_id = p_runner_id AND lease_token = p_lease_token AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.complete_asi_runtime_bridge_task(
  p_client_id TEXT,
  p_runner_id TEXT,
  p_task_id UUID,
  p_lease_token UUID,
  p_result JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.asi_runtime_bridge_tasks
  SET status = CASE WHEN p_result->>'status' = 'completed' THEN 'completed' ELSE 'failed' END,
      result = p_result, runner_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_task_id AND client_id = p_client_id AND status = 'running'
    AND runner_id = p_runner_id AND lease_token = p_lease_token AND lease_expires_at > now()
    AND jsonb_typeof(p_result) = 'object' AND p_result->>'schemaVersion' = 'asi.runtime.result.v1';
  IF NOT FOUND THEN RAISE EXCEPTION 'lease_conflict'; END IF;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.gate_asi_runtime_bridge_task(
  p_client_id TEXT,
  p_runner_id TEXT,
  p_task_id UUID,
  p_lease_token UUID,
  p_gate JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_gate public.asi_runtime_bridge_owner_gates%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_gate) <> 'object' OR p_gate->>'schemaVersion' <> 'asi.runtime.owner-gate.v1'
     OR p_gate->>'taskCycle' IS NULL OR p_gate->>'expiresAt' IS NULL
     OR (p_gate->>'expiresAt')::timestamptz <= now() THEN RAISE EXCEPTION 'invalid_owner_gate'; END IF;
  UPDATE public.asi_runtime_bridge_tasks
  SET status = 'awaiting_owner', runner_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_task_id AND client_id = p_client_id AND status = 'running'
    AND runner_id = p_runner_id AND lease_token = p_lease_token AND lease_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'lease_conflict'; END IF;

  INSERT INTO public.asi_runtime_bridge_owner_gates(task_id, client_id, task_cycle, request)
  VALUES (p_task_id, p_client_id, p_gate->>'taskCycle', p_gate)
  RETURNING * INTO v_gate;
  RETURN jsonb_build_object('gateId', v_gate.id, 'taskId', v_gate.task_id, 'status', v_gate.status);
END;
$$;

CREATE FUNCTION public.expire_asi_runtime_bridge_owner_gates(p_client_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH expired_gates AS (
    UPDATE public.asi_runtime_bridge_owner_gates
    SET status = 'expired'
    WHERE client_id = p_client_id AND status = 'pending'
      AND (request->>'expiresAt')::timestamptz <= now()
    RETURNING task_id
  ), failed_tasks AS (
    UPDATE public.asi_runtime_bridge_tasks
    SET status = 'failed',
        result = jsonb_build_object(
          'schemaVersion', 'asi.runtime.result.v1', 'status', 'failed',
          'summary', 'Owner gate expired.', 'changedFiles', '[]'::jsonb,
          'checks', '[]'::jsonb, 'artifacts', '[]'::jsonb, 'blockers', jsonb_build_array('owner_gate_expired')
        ),
        updated_at = now()
    WHERE id IN (SELECT task_id FROM expired_gates) AND status = 'awaiting_owner'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM failed_tasks;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.fail_asi_runtime_bridge_task(
  p_client_id TEXT,
  p_runner_id TEXT,
  p_task_id UUID,
  p_lease_token UUID,
  p_retryable BOOLEAN,
  p_error_code TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.asi_runtime_bridge_tasks
  SET status = CASE WHEN p_retryable AND recovery_count < 2 THEN 'queued' ELSE 'failed' END,
      recovery_count = CASE WHEN p_retryable AND recovery_count < 2 THEN recovery_count + 1 ELSE recovery_count END,
      available_at = CASE WHEN p_retryable AND recovery_count < 2 THEN now() + interval '15 seconds' ELSE available_at END,
      result = CASE WHEN p_retryable AND recovery_count < 2 THEN NULL ELSE jsonb_build_object(
        'schemaVersion', 'asi.runtime.result.v1', 'status', 'failed',
        'summary', 'Runtime execution failed.', 'changedFiles', '[]'::jsonb,
        'checks', '[]'::jsonb, 'artifacts', '[]'::jsonb, 'blockers', jsonb_build_array(p_error_code)
      ) END,
      runner_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_task_id AND client_id = p_client_id AND status = 'running'
    AND runner_id = p_runner_id AND lease_token = p_lease_token AND lease_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'lease_conflict'; END IF;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.decide_asi_runtime_bridge_owner_gate(
  p_client_id TEXT,
  p_task_id UUID,
  p_gate_id UUID,
  p_decision_id TEXT,
  p_task_cycle TEXT,
  p_decision TEXT,
  p_source TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_gate public.asi_runtime_bridge_owner_gates%ROWTYPE;
  v_task public.asi_runtime_bridge_tasks%ROWTYPE;
  v_payload JSONB;
  v_deduplicated BOOLEAN := FALSE;
BEGIN
  IF p_client_id IS NULL OR p_task_id IS NULL OR p_gate_id IS NULL
     OR p_decision_id IS NULL OR p_task_cycle IS NULL OR p_decision IS NULL OR p_source IS NULL THEN
    RAISE EXCEPTION 'invalid_owner_decision';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id || ':' || p_decision_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_gate_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.asi_runtime_bridge_owner_gates
    WHERE client_id = p_client_id AND decision_id = p_decision_id AND id <> p_gate_id
  ) THEN
    RAISE EXCEPTION 'decision_conflict';
  END IF;
  SELECT * INTO v_gate FROM public.asi_runtime_bridge_owner_gates
  WHERE id = p_gate_id AND task_id = p_task_id AND client_id = p_client_id;
  IF NOT FOUND OR v_gate.task_cycle IS DISTINCT FROM p_task_cycle THEN RAISE EXCEPTION 'owner_gate_mismatch'; END IF;

  v_payload := jsonb_build_object(
    'decisionId', p_decision_id, 'decision', p_decision, 'source', p_source,
    'taskCycle', p_task_cycle, 'note', p_note, 'gateId', v_gate.id,
    'ownerGate', v_gate.request
  );
  IF v_gate.status <> 'pending' THEN
    IF v_gate.decision_id = p_decision_id AND v_gate.decision = v_payload THEN
      v_deduplicated := TRUE;
    ELSE
      RAISE EXCEPTION 'decision_conflict';
    END IF;
  ELSE
    IF p_decision NOT IN ('approved', 'rejected') OR p_source IS DISTINCT FROM 'explicit_owner_message'
       OR (v_gate.request->>'expiresAt')::timestamptz <= now() THEN
      RAISE EXCEPTION 'owner_gate_mismatch';
    END IF;
    UPDATE public.asi_runtime_bridge_owner_gates
    SET status = p_decision, decision_id = p_decision_id, decision = v_payload, decided_at = now()
    WHERE id = p_gate_id RETURNING * INTO v_gate;

    UPDATE public.asi_runtime_bridge_tasks
    SET status = CASE WHEN p_decision = 'approved' THEN 'queued' ELSE 'failed' END,
        owner_decision = v_payload,
        available_at = CASE WHEN p_decision = 'approved' THEN now() ELSE available_at END,
        result = CASE WHEN p_decision = 'rejected' THEN jsonb_build_object(
          'schemaVersion', 'asi.runtime.result.v1', 'status', 'failed',
          'summary', 'Owner rejected the requested action.', 'changedFiles', '[]'::jsonb,
          'checks', '[]'::jsonb, 'artifacts', '[]'::jsonb, 'blockers', jsonb_build_array('owner_rejected')
        ) ELSE NULL END,
        updated_at = now()
    WHERE id = p_task_id AND client_id = p_client_id AND status = 'awaiting_owner'
    RETURNING * INTO v_task;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner_gate_mismatch'; END IF;
  END IF;

  IF v_deduplicated THEN
    SELECT * INTO v_task FROM public.asi_runtime_bridge_tasks WHERE id = p_task_id AND client_id = p_client_id;
  END IF;
  RETURN jsonb_build_object(
    'deduplicated', v_deduplicated,
    'task', jsonb_build_object(
      'id', v_task.id, 'chatgpt_task_id', v_task.chatgpt_task_id,
      'conversation_id', v_task.conversation_id, 'status', v_task.status,
      'attempt_count', v_task.attempt_count, 'created_at', v_task.created_at, 'updated_at', v_task.updated_at
    ),
    'gate', jsonb_build_object(
      'id', v_gate.id, 'task_id', v_gate.task_id, 'status', v_gate.status,
      'request', v_gate.request, 'created_at', v_gate.created_at
    )
  );
END;
$$;

ALTER TABLE public.asi_runtime_bridge_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asi_runtime_bridge_owner_gates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asi_runtime_bridge_tasks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.asi_runtime_bridge_owner_gates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.asi_runtime_bridge_tasks TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.asi_runtime_bridge_owner_gates TO service_role;

REVOKE ALL ON FUNCTION public.submit_asi_runtime_bridge_task(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_asi_runtime_bridge_task(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gate_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_asi_runtime_bridge_owner_gates(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_asi_runtime_bridge_owner_gate(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_asi_runtime_bridge_task(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_asi_runtime_bridge_task(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.gate_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_asi_runtime_bridge_owner_gates(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_asi_runtime_bridge_task(TEXT, TEXT, UUID, UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_asi_runtime_bridge_owner_gate(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE POLICY asi_runtime_bridge_tasks_service_role
  ON public.asi_runtime_bridge_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY asi_runtime_bridge_gates_service_role
  ON public.asi_runtime_bridge_owner_gates FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
