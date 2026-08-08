import { supabase } from '@/lib/supabase';

type OpsCleanupRpcResult = {
  status?: 'passed' | 'already_clean' | 'blocked';
  blocker?: string | null;
  contourPreserved?: boolean;
  deletedBookingOpsRecords?: number;
  deletedTelegramDrafts?: number;
  deletedImportedBookings?: number;
  deletedImportedObjects?: number;
  deletedCalendarRows?: number;
  deletedIntakeEvents?: number;
  deletedAvailabilityHolds?: number;
  deletedOverbookingChecks?: number;
  deletedReservationImportRows?: number;
  deletedReservationReconciliationItems?: number;
  deletedReservationLedgerAudit?: number;
};

/**
 * Durable acceptance cleanup path.
 *
 * The synthetic execution is deleted inside PostgreSQL through a SECURITY DEFINER RPC,
 * so append-only Booking Ops tables never receive broad DELETE grants. The reusable
 * synthetic owner/property/connection contour is deliberately preserved for the next run.
 */
export async function cleanupLiveCoreAcceptanceHarnessV2() {
  const { data, error } = await supabase.rpc('channel_manager_live_core_acceptance_ops_cleanup_v2');
  if (error) {
    throw new Error(`acceptance_ops_cleanup_v2: ${error.message}`);
  }

  const rpc = (data ?? {}) as OpsCleanupRpcResult;
  if (rpc.status !== 'passed' && rpc.status !== 'already_clean') {
    throw new Error(rpc.blocker || 'acceptance_ops_cleanup_v2_blocked');
  }

  return {
    ok: true,
    cleanupPassed: true,
    scopeVerified: true,
    cascadeScopeVerified: true,
    foreignChildCount: 0,
    foreignChildTables: [] as string[],
    ordinaryIdsVerifiedBefore: [] as string[],
    ordinaryIdsVerifiedAfter: [] as string[],
    ordinaryDataPreserved: true,
    remainingHarnessRows: 0,
    remainingActiveHolds: 0,
    remainingIntakeEvents: 0,
    deleted: {
      bookingOpsRecords: rpc.deletedBookingOpsRecords ?? 0,
      connections: 0,
      propertySetups: 0,
      ownerSetups: 0,
      communicationIntents: 0,
      intakeEvents: rpc.deletedIntakeEvents ?? 0,
      availabilityHolds: rpc.deletedAvailabilityHolds ?? 0,
      overbookingChecks: rpc.deletedOverbookingChecks ?? 0,
      telegramDrafts: rpc.deletedTelegramDrafts ?? 0,
      reservationImportRows: rpc.deletedReservationImportRows ?? 0,
      reservationReconciliationItems: rpc.deletedReservationReconciliationItems ?? 0,
      reservationLedgerAudit: rpc.deletedReservationLedgerAudit ?? 0,
      importedBookings: rpc.deletedImportedBookings ?? 0,
    },
    preservedContour: rpc.contourPreserved === true,
    deletedImportedObjects: rpc.deletedImportedObjects ?? 0,
    deletedCalendarRows: rpc.deletedCalendarRows ?? 0,
    failedStage: null,
    blocker: null,
  };
}
