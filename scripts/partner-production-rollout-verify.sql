DO $verify$
DECLARE
  required_relation TEXT;
  required_relations CONSTANT TEXT[] := ARRAY[
    'partner_account_bindings',
    'partner_communication_sessions',
    'partner_communication_turns',
    'partner_communication_handoffs',
    'partner_communication_actions',
    'partner_api_credentials',
    'partner_communication_inbox',
    'partner_property_bindings',
    'partner_booking_bindings',
    'partner_communication_decisions',
    'partner_service_recovery_cases',
    'partner_service_recovery_events',
    'partner_guest_reviews',
    'partner_review_events',
    'partner_reputation_signals',
    'partner_revenue_events',
    'partner_revenue_observations',
    'partner_shadow_pricing_recommendations',
    'partner_pricing_recommendation_feedback'
  ];
BEGIN
  FOREACH required_relation IN ARRAY required_relations LOOP
    IF to_regclass('public.' || required_relation) IS NULL THEN
      RAISE EXCEPTION 'Required partner relation is missing: %', required_relation;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT required.column_name
    FROM unnest(ARRAY[
      'wifi_notes',
      'door_code_notes',
      'parking_rules',
      'parking_paid_or_free',
      'parking_location_notes'
    ]) AS required(column_name)
    LEFT JOIN information_schema.columns AS actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'tg_property_knowledge'
     AND actual.column_name = required.column_name
    WHERE actual.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'Strict property knowledge columns are incomplete.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(required_relations)
      AND (relation.relrowsecurity IS NOT TRUE OR relation.relforcerowsecurity IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'A required partner relation is missing enforced RLS.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(required_relations) AS required(relation_name)
    WHERE has_table_privilege('anon', 'public.' || required.relation_name, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || required.relation_name, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'A required partner relation is readable by anon or authenticated.';
  END IF;
END
$verify$;

SELECT 'PARTNER_ROLLOUT_SCHEMA_VERIFICATION=passed' AS result;
