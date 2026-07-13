export type BookingAutomationRolloutMode = 'shadow' | 'canary' | 'active';

export function resolveBookingAutomationRolloutMode(value: unknown = process.env.BOOKING_OPS_AUTOMATION_MODE): BookingAutomationRolloutMode {
  if (typeof value !== 'string') return 'shadow';
  return value === 'shadow' || value === 'canary' || value === 'active' ? value : 'shadow';
}

export function resolveBookingAutomationCanaryBookingIds(value: unknown = process.env.BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS): ReadonlySet<string> {
  if (typeof value !== 'string') return new Set();
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

export function isBookingAutomationExecutionAllowed(input: {
  mode: BookingAutomationRolloutMode;
  bookingId: string;
  canaryBookingIds: ReadonlySet<string> | readonly string[];
}): boolean {
  if (input.mode === 'active') return true;
  if (input.mode === 'shadow') return false;
  return new Set(input.canaryBookingIds).has(input.bookingId);
}
