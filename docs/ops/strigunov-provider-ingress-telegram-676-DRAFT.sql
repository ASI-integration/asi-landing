BEGIN;
CREATE TABLE IF NOT EXISTS public.asi_ingress_events_676 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  property_id uuid NOT NULL REFERENCES public.properties(id),
  source_id text NOT NULL CHECK(source_id ~ '^[A-Za-z0-9_-]{2,64}$'),
  external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 190),
  recurrence_id text NOT NULL DEFAULT '',
  check_in_at timestamptz,
  check_out_at timestamptz,
  sequence_no integer NOT NULL CHECK(sequence_no >= 0),
  event_hash text NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$'),
  review_status text NOT NULL CHECK(review_status IN ('ready_for_review','conflict_review','cancelled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,property_id,source_id,external_id,recurrence_id),
  CHECK(review_status='cancelled' OR (check_in_at IS NOT NULL AND check_out_at>check_in_at))
);
CREATE INDEX IF NOT EXISTS asi_ingress_overlap_676 ON public.asi_ingress_events_676(property_id,check_in_at,check_out_at)
  WHERE review_status='ready_for_review';
CREATE TABLE IF NOT EXISTS public.asi_ingress_deadletters_676 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,property_id uuid NOT NULL,source_id text NOT NULL,
  event_hash text NOT NULL, error_code text NOT NULL CHECK (error_code ~ '^[A-Z0-9_]{3,80}$'),
  retry_count integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,property_id,source_id,event_hash)
);
CREATE TABLE IF NOT EXISTS public.asi_ingress_cursors_676 (
  account_id uuid NOT NULL,property_id uuid NOT NULL,source_id text NOT NULL,
  cursor_value text NOT NULL CHECK(length(cursor_value) BETWEEN 1 AND 512),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,property_id,source_id)
);
CREATE TABLE IF NOT EXISTS public.asi_telegram_bindings_676 (
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  property_id uuid NOT NULL REFERENCES public.properties(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  telegram_user_id bigint NOT NULL CHECK(telegram_user_id>0),
  chat_id bigint NOT NULL CHECK(chat_id>0),
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY(account_id,property_id,user_id),
  UNIQUE(account_id,property_id,telegram_user_id,chat_id)
);
CREATE TABLE IF NOT EXISTS public.asi_telegram_outbox_676 (
  task_id uuid PRIMARY KEY REFERENCES public.ops_tasks(id),
  account_id uuid NOT NULL,property_id uuid NOT NULL,
  user_id uuid NOT NULL,chat_id bigint NOT NULL,
  FOREIGN KEY(account_id,property_id,user_id) REFERENCES public.asi_telegram_bindings_676(account_id,property_id,user_id),
  nonce_hash text NOT NULL CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
  message_text text NOT NULL CHECK(length(message_text) BETWEEN 1 AND 4096),
  send_status text NOT NULL DEFAULT 'queued_dry_run'
    CHECK(send_status IN ('queued_dry_run','sent','retryable','dlq')),
  message_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.asi_telegram_update_ids_676 (
  account_id uuid NOT NULL, update_id bigint NOT NULL, task_id uuid NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,update_id)
);
DO $rls$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['asi_ingress_events_676','asi_ingress_deadletters_676','asi_ingress_cursors_676','asi_telegram_bindings_676','asi_telegram_outbox_676','asi_telegram_update_ids_676']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO service_role',t);
 END LOOP;
END $rls$;
GRANT USAGE, SELECT ON SEQUENCE public.asi_ingress_events_676_id_seq, public.asi_ingress_deadletters_676_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.asi_ingest_event_676(
 p_account uuid,p_property uuid,p_source text,p_external text,p_recurrence text,
 p_start timestamptz,p_end timestamptz,p_seq integer,p_cancelled boolean,p_hash text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE old public.asi_ingress_events_676%ROWTYPE; has_conflict boolean; status text;
BEGIN
 IF p_account IS NULL OR p_property IS NULL OR p_source !~ '^[A-Za-z0-9_-]{2,64}$'
  OR length(p_external) NOT BETWEEN 1 AND 190 OR p_seq<0 OR p_hash !~ '^[a-f0-9]{64}$'
  OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property AND p.account_id=p_account)
 THEN RAISE EXCEPTION 'ingress_scope_invalid' USING ERRCODE='42501';END IF;
 IF NOT p_cancelled AND (p_start IS NULL OR p_end IS NULL OR p_start>=p_end)
 THEN RAISE EXCEPTION 'ingress_dates_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text||':'||p_property::text,676));
 SELECT * INTO old FROM public.asi_ingress_events_676
 WHERE account_id=p_account AND property_id=p_property AND source_id=p_source
  AND external_id=p_external AND recurrence_id=coalesce(p_recurrence,'') FOR UPDATE;
 IF FOUND THEN
  IF p_seq<old.sequence_no THEN RETURN 'stale';END IF;
  IF p_seq=old.sequence_no THEN
   IF p_hash=old.event_hash THEN RETURN 'replayed';END IF;
   RAISE EXCEPTION 'ingress_revision_collision' USING ERRCODE='23505';
  END IF;
 END IF;
 IF p_cancelled THEN
  status='cancelled';
 ELSE
  SELECT EXISTS(
    SELECT 1 FROM public.asi_ingress_events_676 e
    WHERE e.property_id=p_property AND e.review_status='ready_for_review'
      AND e.check_in_at<p_end AND e.check_out_at>p_start
      AND (e.source_id,e.external_id,e.recurrence_id) IS DISTINCT FROM (p_source,p_external,coalesce(p_recurrence,''))
  ) OR EXISTS(
    SELECT 1 FROM public.booking_ops_records b
    WHERE b.account_id=p_account::text AND b.property_id=p_property::text
      AND b.normalized_status IN ('confirmed','checked_in')
      AND b.check_in_at<p_end AND b.check_out_at>p_start
  ) INTO has_conflict;
  status=CASE WHEN has_conflict THEN 'conflict_review' ELSE 'ready_for_review' END;
 END IF;
 INSERT INTO public.asi_ingress_events_676(account_id,property_id,source_id,external_id,recurrence_id,check_in_at,check_out_at,sequence_no,event_hash,review_status)
 VALUES(p_account,p_property,p_source,p_external,coalesce(p_recurrence,''),p_start,p_end,p_seq,p_hash,status)
 ON CONFLICT(account_id,property_id,source_id,external_id,recurrence_id)
 DO UPDATE SET check_in_at=excluded.check_in_at,check_out_at=excluded.check_out_at,
 sequence_no=excluded.sequence_no,event_hash=excluded.event_hash,
 review_status=excluded.review_status,updated_at=now();
 RETURN CASE WHEN status='ready_for_review' THEN 'accepted'
             WHEN status='conflict_review' THEN 'conflict_review'
             ELSE 'cancelled' END;
END $$;
CREATE OR REPLACE FUNCTION public.asi_ingress_dlq_676(
 p_account uuid,p_property uuid,p_source text,p_hash text,p_code text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.asi_ingress_deadletters_676(account_id,property_id,source_id,event_hash,error_code)
 VALUES(p_account,p_property,p_source,p_hash,p_code)
 ON CONFLICT(account_id,property_id,source_id,event_hash)
 DO UPDATE SET retry_count=public.asi_ingress_deadletters_676.retry_count+1,
 error_code=excluded.error_code,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION public.asi_telegram_enqueue_676(
 p_account uuid,p_property uuid,p_task uuid,p_user uuid,p_chat bigint,
 p_nonce_hash text,p_text text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE existing record;
BEGIN
 IF NOT EXISTS(
 SELECT 1 FROM public.ops_tasks t
 JOIN public.properties p ON p.id::text=t.property_id AND p.account_id=p_account
 JOIN public.asi_telegram_bindings_676 b ON b.account_id=p_account AND b.property_id=p_property AND b.user_id=p_user
 WHERE t.id=p_task AND t.property_id=p_property::text AND t.assigned_to=p_user::text
 AND t.task_type='turnover' AND t.work_kind IN ('cleaning','linen','supplies','inspection')
 AND b.enabled AND b.chat_id=p_chat
 ) THEN RETURN 'not_assigned';END IF;
 INSERT INTO public.asi_telegram_outbox_676(task_id,account_id,property_id,user_id,chat_id,nonce_hash,message_text)
 VALUES(p_task,p_account,p_property,p_user,p_chat,p_nonce_hash,p_text)
 ON CONFLICT(task_id) DO NOTHING;
 IF FOUND THEN RETURN 'created';END IF;
 RETURN 'replayed';
END $$;
CREATE OR REPLACE FUNCTION public.asi_telegram_transition_676(
 p_task uuid,p_update bigint,p_from bigint,p_chat bigint,p_nonce text,p_action text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE rowdata record; current_status text;
BEGIN
 IF p_update<0 OR p_from<=0 OR p_chat<=0 OR p_action NOT IN ('accept','close') THEN RETURN 'forbidden';END IF;
 SELECT o.*,t.task_status INTO rowdata FROM public.asi_telegram_outbox_676 o
 JOIN public.ops_tasks t ON t.id=o.task_id WHERE o.task_id=p_task FOR UPDATE OF o,t;
 IF NOT FOUND THEN RETURN 'not_assigned';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.asi_telegram_bindings_676 b
   JOIN public.properties p ON p.id=b.property_id AND p.account_id=b.account_id
   JOIN public.ops_tasks t ON t.id=p_task AND t.property_id=b.property_id::text AND t.assigned_to=b.user_id::text
   WHERE b.account_id=rowdata.account_id AND b.property_id=rowdata.property_id
    AND b.user_id=rowdata.user_id AND b.chat_id=p_chat AND b.telegram_user_id=p_from AND b.enabled)
  OR rowdata.chat_id<>p_chat OR rowdata.nonce_hash<>p_nonce THEN RETURN 'forbidden';END IF;
 IF EXISTS(SELECT 1 FROM public.asi_telegram_update_ids_676 WHERE account_id=rowdata.account_id AND update_id=p_update) THEN RETURN 'replayed';END IF;
 IF (p_action='accept' AND rowdata.task_status<>'open')
    OR (p_action='close' AND rowdata.task_status<>'in_progress') THEN RETURN 'invalid_transition';END IF;
 INSERT INTO public.asi_telegram_update_ids_676(account_id,update_id,task_id) VALUES(rowdata.account_id,p_update,p_task)
 ON CONFLICT(account_id,update_id) DO NOTHING;
 IF NOT FOUND THEN RETURN 'replayed';END IF;
 UPDATE public.ops_tasks SET task_status=CASE WHEN p_action='accept' THEN 'in_progress' ELSE 'resolved' END,
   updated_at=now(),resolved_at=CASE WHEN p_action='close' THEN now() ELSE NULL END
 WHERE id=p_task AND property_id=rowdata.property_id::text AND assigned_to=rowdata.user_id::text
 AND task_status=rowdata.task_status;
 IF NOT FOUND THEN RAISE EXCEPTION 'telegram_transition_atomicity_lost';END IF;
 RETURN 'accepted';
END $$;
CREATE OR REPLACE FUNCTION public.asi_ingress_commit_cursor_676(
 p_account uuid,p_property uuid,p_source text,p_cursor text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF length(p_cursor) NOT BETWEEN 1 AND 512 OR p_source !~ '^[A-Za-z0-9_-]{2,64}$'
 OR NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=p_property AND p.account_id=p_account)
 THEN RAISE EXCEPTION 'ingress_cursor_scope_invalid' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_account::text||':'||p_property::text,676));
 INSERT INTO public.asi_ingress_cursors_676(account_id,property_id,source_id,cursor_value)
 VALUES(p_account,p_property,p_source,p_cursor)
 ON CONFLICT(account_id,property_id,source_id)
 DO UPDATE SET cursor_value=excluded.cursor_value,updated_at=now();
END $$;
DO $grant$ DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('asi_ingest_event_676','asi_ingress_dlq_676','asi_ingress_commit_cursor_676','asi_telegram_enqueue_676','asi_telegram_transition_676')
 LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
 END LOOP;
END $grant$;
COMMIT;
