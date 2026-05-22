import type { NextRequest } from 'next/server';

export const REPORT_DEBUG_TOKEN_HEADER = 'x-report-debug-token';

const LOCATION_REPORT_CONFIRMATION_HEADER = 'x-location-report-confirmation';

export function isReportDebugNonProduction(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function hasValidReportDebugToken(req: Request): boolean {
  const expected = process.env.REPORT_DEBUG_TOKEN?.trim();
  if (!expected) return false;
  const supplied = req.headers.get(REPORT_DEBUG_TOKEN_HEADER)?.trim();
  return Boolean(supplied) && supplied === expected;
}

/** Same internal confirmation header used by paid report process route. */
export function hasLocationReportInternalConfirmation(req: Request): boolean {
  const configured = process.env.LOCATION_REPORT_MANUAL_CONFIRM_KEY?.trim();
  if (!configured) return false;
  const supplied = req.headers.get(LOCATION_REPORT_CONFIRMATION_HEADER)?.trim();
  return Boolean(supplied) && supplied === configured;
}

export function isReportDebugAccessAllowed(req: Request): boolean {
  if (isReportDebugNonProduction()) return true;
  if (hasValidReportDebugToken(req)) return true;
  if (hasLocationReportInternalConfirmation(req)) return true;
  return false;
}

export function reportDebugAccessDeniedResponse(): Response {
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

export function assertReportDebugAccess(req: NextRequest): Response | null {
  if (isReportDebugAccessAllowed(req)) return null;
  return reportDebugAccessDeniedResponse();
}
