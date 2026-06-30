import { initializeLifecycleForBooking } from './lifecycle';

export type BookingOpsCoreLoopInitialization = {
  lifecycleInitialized: true;
  legalPaymentInitialized: true;
};

/**
 * Initializes the persisted minimum needed by every pilot booking.
 * Check-in and checkout readiness are derived from the lifecycle gates and do
 * not need separate placeholder rows until an operator starts those stages.
 */
export async function initializeBookingOpsCoreLoop(
  bookingOpsRecordId: string,
): Promise<BookingOpsCoreLoopInitialization> {
  const lifecycle = await initializeLifecycleForBooking(bookingOpsRecordId);
  if (!lifecycle.ok) {
    throw new Error(lifecycle.error ?? 'lifecycle_initialization_failed');
  }

  // Loaded lazily because the legal/payment module reads records through the
  // Booking Ops repository. At runtime the new record is already persisted.
  const { initializeLegalPaymentForBooking } = await import('./legal-payment-autopilot');
  await initializeLegalPaymentForBooking(bookingOpsRecordId);

  return {
    lifecycleInitialized: true,
    legalPaymentInitialized: true,
  };
}
