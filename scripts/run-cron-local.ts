/**
 * Local cron runner for live validation of right-half stay-flow.
 * Mirrors the logic in src/app/api/cron/advance-stay-flows/route.ts exactly.
 * Run with: npx tsx --env-file=.env.local scripts/run-cron-local.ts
 */

import {
  getDuePreCheckinFlows,
  getStalePreCheckinFlows,
  getDueCheckoutFlows,
  getDueFollowupFlows,
  advancePreCheckin,
  advanceToInStay,
  advanceCheckout,
  advanceFollowup,
} from '../src/lib/communication/stay-flow';

async function main() {
  const log: string[] = [];
  let errors = 0;

  console.log('\n=== PASS 1: reservation_linked → pre_checkin_sent ===');
  const duePreCheckin = await getDuePreCheckinFlows();
  console.log(`  Found ${duePreCheckin.length} flow(s) due for pre-checkin`);
  for (const flow of duePreCheckin) {
    console.log(`  Processing flowId=${flow.id} reservationId=${flow.reservationId} chatId=${flow.chatId} checkinDate=${flow.checkinDate}`);
    try {
      await advancePreCheckin(flow);
      log.push(`pre_checkin_sent reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('  ERROR:', String(err));
      log.push(`ERROR pre_checkin reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  console.log('\n=== PASS 2: pre_checkin_sent → in_stay (stale catch-up) ===');
  const stalePreCheckin = await getStalePreCheckinFlows();
  console.log(`  Found ${stalePreCheckin.length} stale flow(s)`);
  for (const flow of stalePreCheckin) {
    console.log(`  Processing flowId=${flow.id} reservationId=${flow.reservationId} checkinDate=${flow.checkinDate}`);
    try {
      await advanceToInStay(flow);
      log.push(`in_stay_catchup reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('  ERROR:', String(err));
      log.push(`ERROR in_stay reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  console.log('\n=== PASS 3: in_stay → checkout_sent ===');
  const dueCheckout = await getDueCheckoutFlows();
  console.log(`  Found ${dueCheckout.length} flow(s) due for checkout`);
  for (const flow of dueCheckout) {
    console.log(`  Processing flowId=${flow.id} reservationId=${flow.reservationId} chatId=${flow.chatId} checkoutDate=${flow.checkoutDate}`);
    try {
      await advanceCheckout(flow);
      log.push(`checkout_sent reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('  ERROR:', String(err));
      log.push(`ERROR checkout reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  console.log('\n=== PASS 4: checkout_sent → followup_sent ===');
  const dueFollowup = await getDueFollowupFlows();
  console.log(`  Found ${dueFollowup.length} flow(s) due for follow-up`);
  for (const flow of dueFollowup) {
    console.log(`  Processing flowId=${flow.id} reservationId=${flow.reservationId} chatId=${flow.chatId} checkoutDate=${flow.checkoutDate}`);
    try {
      await advanceFollowup(flow);
      log.push(`followup_sent reservationId=${flow.reservationId}`);
    } catch (err) {
      console.error('  ERROR:', String(err));
      log.push(`ERROR followup reservationId=${flow.reservationId}`);
      errors++;
    }
  }

  console.log('\n=== RESULT ===');
  const result = {
    ok: errors === 0,
    advanced: log.filter(l => !l.startsWith('ERROR')).length,
    errors,
    detail: log,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
