import { initializeLifecycleForBooking } from './lifecycle';
import { requireBookingOpsRecordScope } from './repository';

export type BookingOpsCoreLoopInitialization = {
  lifecycleInitialized: true;
  legalPaymentInitialized: true;
  physicalReadinessInitialized: true;
};

/**
 * Initializes the persisted minimum needed by every pilot booking.
 * Check-in and checkout readiness are derived from the lifecycle gates and do
 * not need separate placeholder rows until an operator starts those stages.
 */
export async function initializeBookingOpsCoreLoop(
  bookingOpsRecordId: string,
  expectedScope?: { accountId: string; propertyId: string },
): Promise<BookingOpsCoreLoopInitialization> {
  if (expectedScope) await requireBookingOpsRecordScope(bookingOpsRecordId, expectedScope);
  const lifecycle = await initializeLifecycleForBooking(bookingOpsRecordId, expectedScope);
  if (!lifecycle.ok) {
    throw new Error(lifecycle.error ?? 'lifecycle_initialization_failed');
  }

  // Loaded lazily because the legal execution module reads the persisted record.
  const { initializeGuestLegalExecution } = await import('./guest-legal-deposit-mvd-execution');
  await initializeGuestLegalExecution(bookingOpsRecordId, {}, expectedScope);
  const { ensurePhysicalTasks } = await import('./physical-readiness-execution');
  await ensurePhysicalTasks(bookingOpsRecordId, expectedScope);
  const { orchestrateBookingLifecycle } = await import('./lifecycle-orchestrator');
  await orchestrateBookingLifecycle({ bookingId: bookingOpsRecordId, runType: 'single_booking', expectedScope });

  return {
    lifecycleInitialized: true,
    legalPaymentInitialized: true,
    physicalReadinessInitialized: true,
  };
}
