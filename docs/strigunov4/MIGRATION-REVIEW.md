# Independent STRIGUNOV4 Package A source review

Source: `334d93fc39d2ea51ba283dd0314bbc239ff49707`. Read-only source triage of all 49 candidate files; no database/SSH/provider access, no tests or SQL execution. References below use migration filenames and line numbers. Object extraction is syntactic and requires catalog verification; this is NOT an apply approval.

Snapshot evidence is the sanitized backup inventory from run `38919293685`, not a fresh live catalog. It has 1699 TOC entries and ZERO ACL entries. Prior reconciliation source run is `38914982742`; history omission does not establish object absence.

## Blocking findings

1. Full restore remains BLOCK: missing `supabase_vault` support is not fixed by excluding the extension. Archive omits ACL entries and has no separate role backup, so grants/owners cannot be reconstructed from this archive alone. A partial application-schema restore is not the required full recovery PASS.
2. Applying G0 migration alone is insufficient. Snapshot lacks intake account_id and auto-send account_id, independently required by current code; final knowledge aliases are also incomplete.
3. Broad hardening migration `20260729070000` overlaps three staging-only hardening changes. Preserve all seven staging-only versions and their actual effects, including Runtime Bridge single-lane/owner gates. No blanket history repair or migrations reset.
4. Automatic risk counters are not semantic review: function-body DELETE/UPDATE often describes a future RPC, while `20261003124500` performs immediate scope disabling/backfills despite manifest data_mutation=false.
5. Historical cleanup RPC patches are chained string/regex rewrites, not generic additive schema fixes. Do not install/invoke them as G0 cleanup.
6. `20261006101500` unconditionally alters nine functions, including optional guest-memory functions; a partially provisioned staging can fail before completion.

## Minimal candidate dependency order (conditional, not executable plan)

A. Verify canonical accounts/account_members/properties, booking_ops_records/alerts, availability, communication, intake and property-knowledge base definitions, column types, checks, FK graph, existing functions/triggers and effective ACL under the actual runtime role.
B. If absent/unequal after data preflight: intake account scope `20261003141500`; auto-send account scope `20261003124500`; availability account scope `20261003150000`. These depend on existing base tables and can be independent once prerequisites are proven. Capture prospective backfill/uniqueness/disabled-scope counts before applying.
C. Verify or add INSERT guard `20261005090000` plus its client EXECUTE revocations `20261005095000`; verify communication purpose CHECK `20260810280000` includes actual emitted purposes.
D. Apply only missing compatible knowledge aliases from `20261015103000`; earlier knowledge repairs largely already exist. Verify SELECT grants independently because archive lacks ACL.
E. Apply exact G0 revision/lease/ACK DDL `20261016090000` only after absence/type/grant preflight. It contains BEGIN/COMMIT but is not repeatable CREATE/ADD IF NOT EXISTS. Existing partial objects require explicit reconciliation, not forced replacement.
F. Public lead receipt RPC `20261015000001` only if the chosen end-to-end route actually invokes anonymous lead intake. Guest memory/lifecycle and commercial onboarding are conditional route dependencies; channel/provider/partner/spatial/billing expansion is deferred.

Before any staging SQL: full restorable security-complete backup PASS, catalog/data diff and independent migration approval, then existing main-only/reviewer protected process. Record exact candidate digest and assert all seven staging-only histories and relevant hardening definitions unchanged afterward. Rollback cannot simply drop columns after new data/leases exist; use rehearsed restore and application rollback.

## Per-file necessity and source evidence

| Migration | Category | Assessment | Source lines |
|---|---|---|---|
| 20260720120000_asi_runtime_snapshot_v1.sql | DEFER | Runtime dashboard snapshots; existing table in snapshot proves history omission is not absence. No G0 requirement. | 3, 26, 34 |
| 20260729070000_harden_public_data_api_service_role_only.sql | PRESERVE_COMPARE | Broad public table/sequence/default grant hardening overlaps staging-only security migrations. Compare effective ACL and policies; never replay broad grant resets blindly. | 68, 106, 107, 108, 109 |
| 20260804120000_channel_manager_live_core_initial_sync_v1.sql | DEFER | Channel import initial-sync constraint/index/readiness RPC; OTA import is outside manual intake. | 5, 8, 27, 90, 91 |
| 20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql | DEFER_HIGH | Privileged synthetic cleanup function definitions, dynamic FK discovery and manifest deletion. No installation or invocation needed for G0. | 8, 65, 66, 67, 70 |
| 20260806170000_channel_manager_live_incremental_sync_v1.sql | DEFER | Replaces channel live-sync index and RPCs; requires initial-sync/import connection baseline. | 10, 13, 28, 36, 90 |
| 20260807120000_channel_manager_reconciliation_recovery_v1.sql | DEFER | Channel recovery tables and replacement readiness/finalize functions require incremental core; unrelated to manual intake. | 13, 16, 34, 44, 83 |
| 20260808041000_channel_manager_live_core_recovery_fk_expectation_fix_v1.sql | DEFER | Replaces expected FK function from channel recovery; no table changes, but exact function body dependency. | 10, 63, 64, 65 |
| 20260808051000_channel_manager_live_core_acceptance_cleanup_v2.sql | DEFER_HIGH | SECURITY DEFINER cleanup for deterministic old channel fixtures; never reuse for new G0 records without exact manifest. | 6, 114, 124, 133, 142 |
| 20260809120000_guest_long_term_memory_v1.sql | CONDITIONAL | Guest memory tables/triggers, retention pruning; if exercised must also apply account-scope semantics, not standalone legacy guest-only uniqueness. | 5, 20, 38, 78, 88 |
| 20260809160000_guest_lifecycle_communications_v1.sql | CONDITIONAL | Guest lifecycle ledger and communication policy changes; verify executed workflow uses it and preserve send-off defaults. | 5, 64, 65, 67, 68 |
| 20260809220000_guest_lifecycle_synthetic_acceptance_cleanup.sql | DEFER_HIGH | Historical guest synthetic cleanup function; no generic cleanup authorization. | 5, 231, 237, 241, 245 |
| 20260810190000_guest_lifecycle_synthetic_cleanup_schema_fix.sql | DEFER_HIGH | Replaces preceding cleanup with indirect delivery ownership; depends exact cleanup contract. | 11, 245, 251, 255, 259 |
| 20260810200000_tg_guest_reservations_booking_id_schema_repair.sql | CONDITIONAL | Adds nullable reservation booking_id and index. Snapshot column presence determines necessity. | 8 |
| 20260810210000_guest_lifecycle_cleanup_reservation_uuid_fix.sql | DEFER_HIGH | Patches installed cleanup function source for UUID predicates; exact expected text prerequisite, not fresh table DDL. | 64, 66 |
| 20260810220000_guest_lifecycle_cleanup_remaining_uuid_fix.sql | DEFER_HIGH | Further cleanup function regex patch; exact installed function body/type required. | 52, 54 |
| 20260810230000_tg_guest_identities_schema_repair.sql | CONDITIONAL | Guest identity columns/check repair; column existence alone does not prove constraint equivalence. | 8, 21 |
| 20260810240000_guest_lifecycle_cleanup_text_uuid_repair.sql | DEFER_HIGH | Repairs earlier overly broad cleanup regex; requires definition comparison, not blanket replay. | 63, 65 |
| 20260810250000_tg_property_knowledge_schema_repair.sql | COMPARE_NOOP | Knowledge additive columns already present in snapshot; compare types/defaults before history reconciliation. | 4 |
| 20260810260000_tg_guest_identities_telegram_chat_id_nullable_repair.sql | CONDITIONAL | Drops telegram_chat_id NOT NULL. Actual nullability, not column presence, decides applicability. | 6 |
| 20260810270000_tg_guest_reservations_temporal_schema_repair.sql | CONDITIONAL_HIGH | DATE to TIMESTAMPTZ rewrite uses midnight UTC; verify data/time semantics, table locks and original type before conversion. | 9, 32, 40 |
| 20260810280000_booking_ops_communication_purpose_constraint_repair.sql | G0_CANDIDATE | Replaces communication purpose CHECK; intake emits neutral_booking_acknowledgement. Compare actual constraint body and existing values first. | 8, 11 |
| 20260810290000_guest_lifecycle_synthetic_scope_allowlist_compat.sql | DEFER_HIGH | Trigger and UPDATE alter historical synthetic allowlist; not needed for new explicit no-send fixtures. | 14, 32, 34, 37, 53 |
| 20260810300000_guest_lifecycle_cleanup_reservation_id_cross_type_compat.sql | DEFER_HIGH | Cleanup function cross-type rewrite; depends installed cleanup source, not needed for G0 cleanup plan. | 56, 58 |
| 20260815102111_partner_communication_durable_state_v1.sql | DEFER | Partner durable communication foundation creates unguarded tables; no partner route in manual G0. | 5, 20, 63, 95, 128 |
| 20260815130000_partner_authenticated_inbox_v1.sql | DEFER | Partner inbox/credential tables require partner foundation. No credentials or provider boundary enabled. | 5, 23, 87, 95, 106 |
| 20260815160000_partner_communication_brain_v1.sql | DEFER | Partner authority bindings/decisions depend preceding partner schema; property-column addition is unrelated to manual intake. | 5, 8, 11, 14, 37 |
| 20260815190000_partner_service_recovery_loop_v1.sql | DEFER | Partner service recovery includes action UPDATE/constraint changes; not purely additive. Requires partner brain. | 5, 8, 11, 15, 23 |
| 20260815210000_partner_review_reputation_engine_v1.sql | DEFER | Partner review/reputation ingestion requires partner bindings; outside pilot. | 6, 95, 137, 175, 214 |
| 20260815230000_partner_revenue_shadow_pricing_v1.sql | DEFER | Partner pricing/evidence tables require partner property bindings; outside pilot. | 4, 8, 40, 81, 122 |
| 20260816144742_partner_property_knowledge_schema_completion_v1.sql | COMPARE_NOOP | Strict partner knowledge columns already present in snapshot; no reason to replay solely for migration history. | 4 |
| 20260817090000_telegram_inbound_receipts_v1.sql | DEFER | Telegram inbound receipt claims/retry RPCs; no inbound provider required for manual API synthetic flow. | 5, 49, 50, 51, 53 |
| 20260819110000_commercial_mvp_property_knowledge_contract_v1.sql | CONDITIONAL | Communication knowledge extension. Missing fields overlap final read contract; include only if actual G0 SELECT requires remaining fields. | 4 |
| 20260911000001_payment_event_dedup.sql | DEFER | Payment webhook idempotency persistence; real payments forbidden, not needed to prove zero calls. | 5, 19, 20, 21, 23 |
| 20260917000001_guestautopilot_billing_lifecycle_v1.sql | DEFER | International account billing lifecycle and integration requirements; explicitly separate from RU pilot. | 43, 65, 82, 109, 110 |
| 20260918120000_ru_commercial_pilot_lifecycle_v1.sql | CONDITIONAL | RU pilot commercial state; table exists in snapshot. Only needed if this UI path is exercised; compare constraints/ACL. | 6, 74, 77, 78, 79 |
| 20260920203530_ru_legal_acceptances_v1.sql | CONDITIONAL | Legal acceptance/offer account tables; separate commercial onboarding path, no inferred real consent. | 5, 30, 31, 32, 33 |
| 20260921090000_ru_commercial_pilot_entitlements_v1.sql | CONDITIONAL | Commercial property entitlement guard; table existence/constraints determine delta if registration path is included. | 5, 14, 26, 27, 28 |
| 20260930200000_guest_long_term_memory_account_scope.sql | CONDITIONAL_HIGH | Memory tenancy repair changes primary/unique keys and backfills surrogate IDs, adds NOT VALID scope checks; depends memory foundation and reviewed data/FKs. | 8, 11, 14, 24, 34 |
| 20261003093000_residential_property_spatial_snapshots_v1.sql | DEFER | Residential spatial snapshots are outside manual G0 Booking Ops. | 3, 20, 22 |
| 20261003124500_booking_ops_auto_send_account_scope_v1.sql | G0_CANDIDATE | Auto-send scope/run/delivery account lineage missing in snapshot; disables ALL nonglobal scopes and backfills ownership. Review affected rows and unique/check definitions. | 5, 8, 11, 14, 35 |
| 20261003141500_booking_inbound_intake_account_scope_v1.sql | G0_CANDIDATE | Intake account lineage/generated scope key/account-key uniqueness required by first-writer admission; account_id absent in snapshot. Backfills must be audited. | 6, 9, 19, 28, 31 |
| 20261003150000_booking_availability_account_scope_v1.sql | G0_CANDIDATE | Account-aware availability hold RPC and conflict-check lineage needed by authenticated intake; existing availability/core/channel tables prerequisite. Backfills are data changes. | 4, 10, 15, 20, 25 |
| 20261004123000_channel_manager_live_scope_guard_v1.sql | DEFER | Channel-manager scope guard wraps live core RPCs; deferred while channel ingestion is disabled. | 5, 94, 96, 99, 131 |
| 20261005090000_booking_ops_record_scope_guard_v1.sql | G0_CANDIDATE | INSERT-only canonical property/account trigger; UUID/TEXT comparison and ownership row lock. Must preserve existing equivalent or stronger trigger. | 5, 40, 41, 42, 43 |
| 20261005095000_booking_ops_record_scope_guard_privileges_v1.sql | G0_CANDIDATE | Revokes public/client EXECUTE on preceding insert guard; logically redundant if exact preceding source applied, verify actual ACL rather than replay. | 5, 6, 7, 8 |
| 20261006101500_function_search_path_hardening_v1.sql | CONDITIONAL_HIGH | Nine unconditional ALTER FUNCTION statements. Missing optional memory/normalizer functions can abort entire file; select only proven existing relevant functions without weakening hardening. | comments/DO body |
| 20261015000001_public_pilot_lead_receipts.sql | CONDITIONAL | Public lead receipt/RPC needed only if scenario uses anonymous lead endpoint; staff intake does not imply this dependency. Unguarded CREATE cannot repeat. | 3, 9, 10, 13, 14 |
| 20261015103000_booking_knowledge_read_contract.sql | G0_CANDIDATE | Final Booking Ops knowledge SELECT contract: missing alias columns plus setup-profile SELECT grant; adds schema only, no values or sends. | 3, 16 |
| 20261016090000_g0_operator_revision_takeover.sql | G0_CANDIDATE | Durable revisions/lease begin-end/ACK + minimal lock grants; unguarded DDL requires exact absent-state preflight. Account/member/property/base alert tables and service-role ACL required. | 5, 6, 7, 8, 9 |

## Verification boundaries

All 49 source files were retrieved read-only, with statement/definition/dependency inspection; long cleanup and channel RPCs receive defer/risk classification, not full formal semantic certification. Source hashes in matrix are the supplied manifest hashes; text transport normalizes line endings and is not a new byte-exact remote file hash certification. Snapshot table existence never proves equal function bodies, constraints, policies, grants, data or history. No final minimal executable SQL list is approved until those comparisons and backup gate pass.

## Candidate column comparison against backup snapshot

- 20261003124500_booking_ops_auto_send_account_scope_v1.sql: absent in snapshot: booking_ops_communication_auto_send_scopes.account_id, booking_ops_communication_auto_send_runs.account_id, booking_ops_communication_deliveries.account_id, booking_ops_communication_auto_send_scopes.account_scope_key.
- 20261003141500_booking_inbound_intake_account_scope_v1.sql: absent in snapshot: booking_inbound_intake_events.account_id, booking_inbound_intake_events.account_scope_key.
- 20261003150000_booking_availability_account_scope_v1.sql: absent in snapshot: booking_overbooking_conflict_checks.account_id.
- 20261015103000_booking_knowledge_read_contract.sql: absent in snapshot: tg_property_knowledge.check_in_instructions, tg_property_knowledge.key_instructions, tg_property_knowledge.parking_instructions, tg_property_knowledge.check_out_instructions, tg_property_knowledge.emergency_contacts.
- 20261016090000_g0_operator_revision_takeover.sql: absent in snapshot: booking_ops_alerts.revision, booking_ops_records.automation_paused.
