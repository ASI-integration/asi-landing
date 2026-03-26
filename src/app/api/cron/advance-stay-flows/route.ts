import { NextResponse } from 'next/server';
import {
  getDuePreCheckinFlows,
  getStalePreCheckinFlows,
  getDueCheckoutFlows,
  getDueFollowupFlows,
  advancePreCheckin,
  advanceToInStay,
  advanceCheckout,
  advanceFollowup,
} from '@/lib/communication/stay-flow';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const log: string[] = [];
  let errors = 0;

  // ─── Pass 1: reservation_linked → pre_checkin_sent ────────────────────────
  const duePreCheckin = await getDuePreCheckinFlows();
  for (const flow of duePreCheckin) {
    try {
      await advancePreCheckin(flow);
      log.push(`pre_checkin_sent reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('[advance-stay-flows] advancePreCheckin failed:', String(err));
      log.push(`ERROR pre_checkin reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  // ─── Pass 2: pre_checkin_sent → in_stay (stale catch-up) ─────────────────
  const stalePreCheckin = await getStalePreCheckinFlows();
  for (const flow of stalePreCheckin) {
    try {
      await advanceToInStay(flow);
      log.push(`in_stay_catchup reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('[advance-stay-flows] advanceToInStay failed:', String(err));
      log.push(`ERROR in_stay reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  // ─── Pass 3: in_stay → checkout_sent ─────────────────────────────────────
  const dueCheckout = await getDueCheckoutFlows();
  for (const flow of dueCheckout) {
    try {
      await advanceCheckout(flow);
      log.push(`checkout_sent reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('[advance-stay-flows] advanceCheckout failed:', String(err));
      log.push(`ERROR checkout reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  // ─── Pass 4: checkout_sent → followup_sent ────────────────────────────────
  const dueFollowup = await getDueFollowupFlows();
  for (const flow of dueFollowup) {
    try {
      await advanceFollowup(flow);
      log.push(`followup_sent reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('[advance-stay-flows] advanceFollowup failed:', String(err));
      log.push(`ERROR followup reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  return NextResponse.json({
    ok:       errors === 0,
    advanced: log.filter(l => !l.startsWith('ERROR')).length,
    errors,
    detail:   log,
  });
}
