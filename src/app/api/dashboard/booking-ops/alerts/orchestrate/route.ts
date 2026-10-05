import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { orchestrateAllRelevantOpsAlerts, orchestrateBookingAutomationAndAlertsForBooking, orchestrateOpsAlertsForProperty } from '@/lib/booking-ops/ops-alert-orchestrator';
import { requireBookingOpsApiAccess, requireBookingOpsApiAccount, requireBookingOpsApiPropertyAccess } from '../../access';
import {
  isBookingAutomationExecutionAllowed,
  resolveBookingAutomationCanaryBookingIds,
  resolveBookingAutomationRolloutMode,
} from '@/lib/booking-ops/booking-automation-rollout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const accountAccess = await requireBookingOpsApiAccount(auth.session);
  if (!accountAccess.ok) return accountAccess.response;
  const accountId = accountAccess.accountId;
  const body = await request.json().catch(() => ({})) as { bookingId?: string; propertyId?: string; now?: string; dryRun?: boolean; maxActions?: number; executeAutomation?: boolean };
  const mode = resolveBookingAutomationRolloutMode();
  const canaryBookingIds = resolveBookingAutomationCanaryBookingIds();
  const canaryMatched = mode === 'canary' && Boolean(body.bookingId && canaryBookingIds.has(body.bookingId));
  const executionAllowed = body.bookingId
    ? isBookingAutomationExecutionAllowed({ mode, bookingId: body.bookingId, canaryBookingIds })
    : mode === 'active' || (mode === 'canary' && canaryBookingIds.size > 0);
  const executeAutomation = body.dryRun !== true && body.executeAutomation === true;
  const rollout = { mode, executionAllowed, canaryMatched };
  if (executeAutomation && !executionAllowed) {
    return NextResponse.json({ ok: false, rollout, result: { errors: ['automation_execution_disabled'] } }, { status: 409 });
  }
  let result;
  if (body.bookingId) {
    const bookingAccess = await requireBookingOpsApiAccess(auth.session, body.bookingId);
    if (!bookingAccess.ok) return bookingAccess.response;
    result = await orchestrateBookingAutomationAndAlertsForBooking({
      bookingId: body.bookingId,
      now: body.now,
      expectedAccountId: bookingAccess.accountId,
      expectedPropertyId: bookingAccess.propertyId,
      dryRun: body.dryRun === true,
      executeAutomation,
      reconcileLegacyInPreview: body.dryRun !== true,
      maxActions: body.maxActions,
    });
  } else if (body.propertyId) {
    const propertyAccess = await requireBookingOpsApiPropertyAccess(auth.session, body.propertyId);
    if (!propertyAccess.ok) return propertyAccess.response;
    result = await orchestrateOpsAlertsForProperty(
      propertyAccess.propertyId,
      body.now,
      propertyAccess.accountId,
      { dryRun: body.dryRun === true, executeAutomation },
    );
  } else {
    result = await orchestrateAllRelevantOpsAlerts(body.now, 'manual', accountId, { dryRun: body.dryRun === true, executeAutomation });
  }
  return NextResponse.json({ ok: result.errors.length === 0, rollout, result }, { status: result.errors.length ? 400 : 200 });
}
