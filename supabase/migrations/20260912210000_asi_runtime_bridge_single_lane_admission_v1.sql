-- Forward-only Bridge single-lane admission for Strigunov closed beta.
-- Does not rewrite 20260724120000_asi_chat_runtime_bridge_v1.sql.
--
-- Contract:
--   1. Same client + same idempotency key + same request → return existing row.
--   2. Same idempotency key + conflicting request → idempotency_conflict.
--   3. Genuinely new request while any non-terminal task exists (any client)
--      → admission_busy. Non-terminal: queued | running | awaiting_owner.
--   4. Otherwise insert atomically under a global advisory lock.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_asi_runtime_bridge_single_nonterminal;
--   CREATE OR REPLACE FUNCTION public.submit_asi_runtime_bridge_task(...)
--   using the body from 20260724120000_asi_chat_runtime_bridge_v1.sql.
-- Do not apply this migration to production from this change set.

CREATE UNIQUE INDEX IF NOT EXISTS idx_asi_runtime_bridge_single_nonterminal
  ON public.asi_runtime_bridge_tasks ((true))
  WHERE status IN ('queued', 'running', 'awaiting_owner');

CREATE OR REPLACE FUNCTION public.submit_asi_runtime_bridge_task(
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
  v_active_id UUID;
BEGIN
  IF p_client_id IS NULL OR p_chatgpt_task_id IS NULL OR p_conversation_id IS NULL
     OR p_idempotency_key IS NULL OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
     OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_bridge_task';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('asi_runtime_bridge_single_lane', 0));
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
    SELECT id INTO v_active_id
    FROM public.asi_runtime_bridge_tasks
    WHERE status IN ('queued', 'running', 'awaiting_owner')
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'admission_busy';
    END IF;

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
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_task
    FROM public.asi_runtime_bridge_tasks
    WHERE client_id = p_client_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_task.request_hash = p_request_hash
         AND v_task.chatgpt_task_id = p_chatgpt_task_id
         AND v_task.conversation_id = p_conversation_id THEN
        RETURN jsonb_build_object(
          'deduplicated', TRUE,
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
      END IF;
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    RAISE EXCEPTION 'admission_busy';
END;
$$;
