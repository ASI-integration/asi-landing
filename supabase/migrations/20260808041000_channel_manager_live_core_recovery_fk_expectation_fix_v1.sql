-- Channel Manager Live Core recovery FK expectation fix v1.
-- Append-only correction: booking_lifecycle_gates and booking_lifecycle_exceptions
-- carry booking_id as TEXT business identifiers and do not have FK constraints to
-- public.booking_ops_records. Recovery v1 incorrectly treated them as reviewed FK edges,
-- causing fail-closed preview to report schema drift.
--
-- This migration changes only the reviewed FK expectation function.
-- It does not alter tables, rows, constraints, cleanup logic, or application data.

CREATE OR REPLACE FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('table_name','booking_ops_events','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_tasks','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_telegram_drafts','column_name','booking_ops_record_id','delete_action','a','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_communication_intents','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_guest_intake_sessions','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_guest_intake_submissions','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_guest_documents','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_contracts','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_deposits','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_mvd_reports','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_checkin_execution','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_instay_checkout','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_guest_stay_issues','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_availability_holds','column_name','booking_id','delete_action','n','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_overbooking_conflict_checks','column_name','booking_id','delete_action','n','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_channel_imported_bookings','column_name','matched_booking_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_physical_readiness','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_cleaning_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_linen_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_supplies_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_maintenance_tickets','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_physical_coordination_drafts','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_guest_legal_readiness','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_legal_execution_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_lifecycle_decisions','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_lifecycle_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_lifecycle_runs','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_lifecycle_states','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_sla_items','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_lifecycle_drafts','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_guest_intake_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_checkin_release_drafts','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_autopilot_states','column_name','booking_id','delete_action','c','pk_column','booking_id','deletable',true),
    jsonb_build_object('table_name','booking_ops_domain_events','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_worker_tasks','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_worker_link_audit','column_name','booking_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','booking_ops_alerts','column_name','booking_id','delete_action','c','pk_column','id','deletable',true),
    jsonb_build_object('table_name','booking_ops_alerts','column_name','previous_booking_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_source_links','column_name','booking_ops_record_id','delete_action','c','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_import_rows','column_name','booking_ops_record_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_reconciliation_items','column_name','booking_ops_record_id','delete_action','n','pk_column','id','deletable',false),
    jsonb_build_object('table_name','reservation_ledger_audit','column_name','booking_ops_record_id','delete_action','n','pk_column','id','deletable',false)
  );
$$;

REVOKE ALL ON FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.channel_manager_live_core_recovery_expected_fk_edges() TO service_role;

NOTIFY pgrst, 'reload schema';
