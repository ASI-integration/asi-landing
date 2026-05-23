import type { PersistableLocationReport } from './standalone-report';

export type LocationPaidReportAccessStatus =
  | 'created'
  | 'pending_payment'
  | 'paid_unlocked'
  | 'failed'
  | 'cancelled';

export const LOCATION_REPORT_UNLOCKED_STATUS: LocationPaidReportAccessStatus = 'paid_unlocked';

export function normalizeLocationReportAccessStatus(
  value: unknown,
): LocationPaidReportAccessStatus | null {
  if (
    value === 'created' ||
    value === 'pending_payment' ||
    value === LOCATION_REPORT_UNLOCKED_STATUS ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value as LocationPaidReportAccessStatus;
  }
  return null;
}

export function locationReportAccessStatusForPersistence(
  report: PersistableLocationReport,
): LocationPaidReportAccessStatus {
  const explicit = normalizeLocationReportAccessStatus((report as any).accessStatus);
  if (explicit) return explicit;
  if (report.version === 'v1' && report.reportMode === 'free') return 'created';
  return LOCATION_REPORT_UNLOCKED_STATUS;
}

export function canExposePaidLocationReport(report: PersistableLocationReport): boolean {
  if (report.version === 'v1' && report.reportMode === 'free') return false;
  return locationReportAccessStatusForPersistence(report) === LOCATION_REPORT_UNLOCKED_STATUS;
}
