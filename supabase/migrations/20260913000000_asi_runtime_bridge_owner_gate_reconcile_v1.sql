-- Forward-only Bridge owner-gate crash-recovery reconciliation for Strigunov closed beta.
-- Does not rewrite 20260724120000_asi_chat_runtime_bridge_v1.sql or
-- 20260912210000_asi_runtime_bridge_single_lane_admission_v1.sql.
--
-- Closes the distributed crash window between:
--   1. executor produces owner_gate
--   2. Runtime durably holds the physical OCP lane ACTION_REQUIRED
--   3. Runtime durably records local bridge ownership awaiting_owner
--   4. process crash before/during/after runner_submit_owner_gate
--   5. after restart Runtime cannot tell whether Landing committed the gate
--
-- New runner-internal operation: reconcile_asi_runtime_bridge_owner_gate.
-- Idempotent, attempt-aware, exact-gate-aware. Does not weaken lease fencing on
-- gate_asi_runtime_bridge_task; this is an additional atomic reconciliation path,
-- not a replacement.
--
-- Rollback:
--   REVOKE/DROP FUNCTION public.reconcile_asi_runtime_bridge_owner_gate(...).
--   No column/index changes to roll back.
-- Do not apply this migration to production from this change set.

CREATE FUNCTION public.reconcile_asi_runtime_bridge_owner_gate(
  p_client_id TEXT,
  p_runner_id TEXT,
  p_task_id UUID,
  p_attempt_count INTEGER,
  p_original_lease_token UUID,
  p_gate JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_task public.asi_runtime_bridge_tasks%ROWTYPE;
  v_gate public.asi_runtime_bridge_owner_gates%ROWTYPE;
  v_existing public.asi_runtime_bridge_owner_gates%ROWTYPE;
  v_task_cycle TEXT;
  v_found_existing BOOLEAN;
  v_commit_status TEXT;
BEGIN
  IF p_client_id IS NULL OR p_runner_id IS NULL OR p_task_id IS NULL
     OR p_attempt_count IS NULL OR p_attempt_count < 0
     OR jsonb_typeof(p_gate) <> 'object' OR p_gate->>'schemaVersion' <> 'asi.runtime.owner-gate.v1'
     OR p_gate->>'taskCycle' IS NULL OR length(p_gate->>'taskCycle') NOT BETWEEN 1 AND 200
     OR p_gate->>'expiresAt' IS NULL THEN
    RAISE EXCEPTION 'invalid_owner_gate_reconcile';
  END IF;
  v_task_cycle := p_gate->>'taskCycle';

  -- Serialize every reconciliation call for this exact task. Combined with the
  -- row lock below this rules out a check-then-insert race between two
  -- concurrent reconciliation calls, and between a reconciliation call and a
  -- concurrent runner_claim_task (which uses FOR UPDATE SKIP LOCKED and will
  -- simply skip a row we are holding).
  PERFORM pg_advisory_xact_lock(hashtextextended('asi_runtime_bridge_reconcile:' || p_task_id::text, 0));

  SELECT * INTO v_task
  FROM public.asi_runtime_bridge_tasks
  WHERE id = p_task_id AND client_id = p_client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Unknown task, or task belongs to a different client_id. Same bounded
    -- response either way: no existence leak, no mutation.
    RETURN jsonb_build_object('status', 'CONFLICT', 'task', NULL, 'gate', NULL);
  END IF;

  SELECT * INTO v_existing
  FROM public.asi_runtime_bridge_owner_gates
  WHERE task_id = p_task_id AND task_cycle = v_task_cycle;
  v_found_existing := FOUND;

  IF v_found_existing THEN
    IF v_existing.request <> p_gate THEN
      -- Same task/taskCycle, different payload or identity: fail closed.
      RETURN jsonb_build_object(
        'status', 'CONFLICT',
        'task', jsonb_build_object(
          'taskId', v_task.id, 'status', v_task.status,
          'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
        ),
        'gate', jsonb_build_object(
          'gateId', v_existing.id, 'taskId', v_existing.task_id, 'status', v_existing.status,
          'taskCycle', v_existing.task_cycle, 'createdAt', v_existing.created_at
        )
      );
    END IF;

    IF v_task.status = 'awaiting_owner' AND v_existing.status = 'pending' THEN
      -- Exact replay after a lost HTTP response. Nothing to mutate.
      RETURN jsonb_build_object(
        'status', 'COMMITTED_DEDUPLICATED',
        'task', jsonb_build_object(
          'taskId', v_task.id, 'status', v_task.status,
          'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
        ),
        'gate', jsonb_build_object(
          'gateId', v_existing.id, 'taskId', v_existing.task_id, 'status', v_existing.status,
          'taskCycle', v_existing.task_cycle, 'createdAt', v_existing.created_at
        )
      );
    END IF;

    IF v_task.status IN ('completed', 'failed') THEN
      RETURN jsonb_build_object(
        'status', 'TERMINAL',
        'task', jsonb_build_object(
          'taskId', v_task.id, 'status', v_task.status,
          'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
        ),
        'gate', jsonb_build_object(
          'gateId', v_existing.id, 'taskId', v_existing.task_id, 'status', v_existing.status,
          'taskCycle', v_existing.task_cycle, 'createdAt', v_existing.created_at
        )
      );
    END IF;

    -- Gate already decided/consumed/expired and the task has moved on
    -- (approved continuation reclaimed, or otherwise advanced) without the
    -- task currently sitting in awaiting_owner for this exact cycle. Fence
    -- the stale caller; never re-open a decided gate.
    RETURN jsonb_build_object(
      'status', 'SUPERSEDED',
      'task', jsonb_build_object(
        'taskId', v_task.id, 'status', v_task.status,
        'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
      ),
      'gate', NULL
    );
  END IF;

  -- No gate row exists yet for this exact task_cycle.
  IF v_task.status IN ('completed', 'failed') THEN
    RETURN jsonb_build_object(
      'status', 'TERMINAL',
      'task', jsonb_build_object(
        'taskId', v_task.id, 'status', v_task.status,
        'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
      ),
      'gate', NULL
    );
  END IF;

  IF v_task.status = 'awaiting_owner' THEN
    -- A different gate/cycle already occupies the single owner-gate lane for
    -- this task. This reconciliation attempt is stale; do not touch it.
    RETURN jsonb_build_object(
      'status', 'SUPERSEDED',
      'task', jsonb_build_object(
        'taskId', v_task.id, 'status', v_task.status,
        'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
      ),
      'gate', NULL
    );
  END IF;

  IF v_task.status = 'running' THEN
    IF v_task.attempt_count <> p_attempt_count
       OR v_task.runner_id IS DISTINCT FROM p_runner_id
       OR (p_original_lease_token IS NOT NULL AND v_task.lease_token IS DISTINCT FROM p_original_lease_token) THEN
      -- A newer claim/attempt already superseded this reconciliation. Fail
      -- closed: never resurrect a superseded execution attempt.
      RETURN jsonb_build_object(
        'status', 'SUPERSEDED',
        'task', jsonb_build_object(
          'taskId', v_task.id, 'status', v_task.status,
          'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
        ),
        'gate', NULL
      );
    END IF;
    -- Exact original attempt is still the current claimant. Safe even if the
    -- lease has technically expired: no newer attempt exists (attempt fencing
    -- above proved that), so this is the execution that produced the gate.
    v_commit_status := 'COMMITTED';
  ELSIF v_task.status = 'queued' THEN
    IF v_task.attempt_count <> p_attempt_count THEN
      -- Requeued and reclaimed by a newer attempt. Old reconciliation must
      -- not recreate an owner gate for the superseded attempt.
      RETURN jsonb_build_object(
        'status', 'SUPERSEDED',
        'task', jsonb_build_object(
          'taskId', v_task.id, 'status', v_task.status,
          'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
        ),
        'gate', NULL
      );
    END IF;
    -- Requeued after lease expiry, same still-unsuperseded attempt, no newer
    -- claim: mandatory queued-recovery case. Recover without rerunning the
    -- executor.
    v_commit_status := 'RECOVERED_AND_COMMITTED';
  ELSE
    RETURN jsonb_build_object('status', 'CONFLICT', 'task', NULL, 'gate', NULL);
  END IF;

  IF (p_gate->>'expiresAt')::timestamptz <= now() THEN
    -- The exact original gate is already stale by the time Runtime
    -- reconciles. Do not create a pending gate doomed to immediate
    -- expiration; fail the task the same way expire_asi_runtime_bridge_owner_gates
    -- would once a pending gate ages out.
    UPDATE public.asi_runtime_bridge_tasks
    SET status = 'failed',
        result = jsonb_build_object(
          'schemaVersion', 'asi.runtime.result.v1', 'status', 'failed',
          'summary', 'Owner gate expired.', 'changedFiles', '[]'::jsonb,
          'checks', '[]'::jsonb, 'artifacts', '[]'::jsonb, 'blockers', jsonb_build_array('owner_gate_expired')
        ),
        runner_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_task_id
    RETURNING * INTO v_task;
    RETURN jsonb_build_object(
      'status', 'TERMINAL',
      'task', jsonb_build_object(
        'taskId', v_task.id, 'status', v_task.status,
        'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
      ),
      'gate', NULL
    );
  END IF;

  UPDATE public.asi_runtime_bridge_tasks
  SET status = 'awaiting_owner', runner_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  INSERT INTO public.asi_runtime_bridge_owner_gates(task_id, client_id, task_cycle, request)
  VALUES (p_task_id, p_client_id, v_task_cycle, p_gate)
  RETURNING * INTO v_gate;

  RETURN jsonb_build_object(
    'status', v_commit_status,
    'task', jsonb_build_object(
      'taskId', v_task.id, 'status', v_task.status,
      'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
    ),
    'gate', jsonb_build_object(
      'gateId', v_gate.id, 'taskId', v_gate.task_id, 'status', v_gate.status,
      'taskCycle', v_gate.task_cycle, 'createdAt', v_gate.created_at
    )
  );
EXCEPTION
  WHEN unique_violation THEN
    -- Defense in depth: the advisory lock + row lock above already serialize
    -- all writers for this task_id, so this should be unreachable. If hit,
    -- treat exactly like the lost-response replay path.
    SELECT * INTO v_existing
    FROM public.asi_runtime_bridge_owner_gates
    WHERE task_id = p_task_id AND task_cycle = v_task_cycle;
    IF FOUND AND v_existing.request = p_gate THEN
      SELECT * INTO v_task FROM public.asi_runtime_bridge_tasks WHERE id = p_task_id AND client_id = p_client_id;
      RETURN jsonb_build_object(
        'status', 'COMMITTED_DEDUPLICATED',
        'task', jsonb_build_object(
          'taskId', v_task.id, 'status', v_task.status,
          'attemptCount', v_task.attempt_count, 'updatedAt', v_task.updated_at
        ),
        'gate', jsonb_build_object(
          'gateId', v_existing.id, 'taskId', v_existing.task_id, 'status', v_existing.status,
          'taskCycle', v_existing.task_cycle, 'createdAt', v_existing.created_at
        )
      );
    END IF;
    RAISE EXCEPTION 'owner_gate_mismatch';
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_asi_runtime_bridge_owner_gate(TEXT, TEXT, UUID, INTEGER, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_asi_runtime_bridge_owner_gate(TEXT, TEXT, UUID, INTEGER, UUID, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
