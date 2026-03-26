/**
 * One-shot test-data seeder for stay-flow validation.
 *
 * Seeds:
 *   - tg_property_knowledge  : prop_A (idempotent — ON CONFLICT DO NOTHING)
 *   - tg_guest_reservations  : one test reservation with reservation_ref='TEST-VALRUN-001'
 *   - tg_stay_flows          : matching flow in reservation_linked state
 *
 * Seeded dates are always relative to today, so the runner can find them:
 *   - check_in  = today + 1 day  (triggers pre_checkin_sent within 2-day window)
 *   - check_out = today + 3 days
 *
 * HOW TO USE:
 *   GET /api/admin/seed-test-data
 *   Header: x-admin-secret: {ADMIN_SECRET env var}
 *
 * Returns the seeded reservation_id which you need to verify tg_stay_flows.
 */

import { NextResponse } from 'next/server';
import { supabase }     from '@/lib/supabase';

const ADMIN_SECRET     = process.env.ADMIN_SECRET;
const TEST_RESERVATION = 'TEST-VALRUN-001';
const TEST_PROPERTY    = 'prop_A';

// Use the known real chat_id from tg_conversation_sessions so the runner
// can actually send a message. Falls back to null if no real chat exists.
const TEST_CHAT_ID = 931919812; // real chat seen in DB

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET(req: Request) {
  const secret = req.headers.get('x-admin-secret');
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkIn  = todayPlus(1);   // tomorrow — inside 2-day pre-checkin window
  const checkOut = todayPlus(3);
  const log: string[] = [];

  // ── 1. Ensure prop_A property knowledge exists ───────────────────────────
  const { error: pkErr } = await supabase
    .from('tg_property_knowledge')
    .upsert(
      {
        property_id:            TEST_PROPERTY,
        object_name:            'Demo Apartment — Pilot Property',
        check_in_instructions:  'Smart lock code is 1234*. Check-in is at 3:00 PM.',
        check_out_instructions: 'Leave keys on table. Checkout at 11:00 AM.',
        wifi_instructions:      'Network: GuestWifi, Pass: secret123',
        house_rules:            'No smoking, no pets. Parties are strictly forbidden.',
        property_policy:        'Strict quiet hours from 10 PM to 8 AM.',
        emergency_contacts:     'Call maintenance at 555-0199 for plumbing/heating issues.',
        upsells:                'Late checkout available for $50. Extra towels $10.',
      },
      { onConflict: 'property_id', ignoreDuplicates: false },
    );

  if (pkErr) {
    log.push(`ERROR property_knowledge: ${pkErr.message}`);
  } else {
    log.push('ok property_knowledge prop_A upserted');
  }

  // ── 2. Upsert test reservation ───────────────────────────────────────────
  const { data: resData, error: resErr } = await supabase
    .from('tg_guest_reservations')
    .upsert(
      {
        reservation_ref: TEST_RESERVATION,
        guest_id:        `tg_${TEST_CHAT_ID}`,
        chat_id:         TEST_CHAT_ID,
        property_id:     TEST_PROPERTY,
        guest_name:      'Val Runner',
        check_in:        checkIn,
        check_out:       checkOut,
        status:          'confirmed',
      },
      { onConflict: 'reservation_ref', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (resErr) {
    log.push(`ERROR guest_reservations: ${resErr.message}`);
    return NextResponse.json({ ok: false, log }, { status: 500 });
  }

  const reservationId = (resData as { id: string }).id;
  log.push(`ok guest_reservations id=${reservationId} ref=${TEST_RESERVATION}`);

  // ── 3. Upsert stay flow in reservation_linked state ──────────────────────
  const { error: sfErr } = await supabase
    .from('tg_stay_flows')
    .upsert(
      {
        reservation_id:  reservationId,
        chat_id:         TEST_CHAT_ID,
        guest_id:        `tg_${TEST_CHAT_ID}`,
        property_id:     TEST_PROPERTY,
        flow_status:     'reservation_linked',
        checkin_date:    checkIn,
        checkout_date:   checkOut,
      },
      { onConflict: 'reservation_id', ignoreDuplicates: true }, // do NOT overwrite status
    );

  if (sfErr) {
    log.push(`ERROR stay_flows: ${sfErr.message}`);
  } else {
    log.push(`ok stay_flows reservation_linked checkin=${checkIn} checkout=${checkOut}`);
  }

  return NextResponse.json({
    ok:            !log.some(l => l.startsWith('ERROR')),
    reservationId,
    checkIn,
    checkOut,
    testChatId:    TEST_CHAT_ID,
    log,
    nextStep:      'Call GET /api/cron/advance-stay-flows with Authorization: Bearer {CRON_SECRET} and observe tg_stay_flows.',
  });
}
