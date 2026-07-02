import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import {
  checkAvailabilityConflict,
  confirmAvailabilityHold,
  createAvailabilityBlock,
  createAvailabilityHold,
  expireAvailabilityHolds,
  releaseAvailabilityBlock,
  releaseAvailabilityHold,
} from '@/lib/booking-ops/availability-overbooking-protection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'check_conflict', 'create_hold', 'release_hold', 'confirm_hold', 'expire_holds',
  'create_block', 'release_block', 'mark_needs_review', 'add_note',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function value(body: Record<string, unknown>, camel: string, snake: string): string | null {
  const result = String(body[camel] ?? body[snake] ?? '').trim();
  return result || null;
}

function scope(body: Record<string, unknown>) {
  return {
    bookingId: value(body, 'bookingId', 'booking_id'),
    propertySetupId: value(body, 'propertySetupId', 'property_setup_id'),
    propertyId: value(body, 'propertyId', 'property_id'),
    dateFrom: value(body, 'dateFrom', 'date_from'),
    dateTo: value(body, 'dateTo', 'date_to'),
  };
}

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  const action = String(body.action ?? '');
  if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, message: 'Неизвестное действие.' }, { status: 400 });
  try {
    let result: unknown;
    if (action === 'check_conflict') result = await checkAvailabilityConflict(scope(body), { checkType: 'manual_review' });
    else if (action === 'create_hold') result = await createAvailabilityHold({ ...scope(body), source: 'operator', holdMinutes: Number(body.holdMinutes ?? 30) });
    else if (action === 'release_hold') result = await releaseAvailabilityHold(value(body, 'holdId', 'hold_id') ?? '');
    else if (action === 'confirm_hold') result = await confirmAvailabilityHold(value(body, 'holdId', 'hold_id') ?? '', value(body, 'bookingId', 'booking_id') ?? undefined);
    else if (action === 'expire_holds') result = await expireAvailabilityHolds({ propertyId: value(body, 'propertyId', 'property_id') ?? undefined });
    else if (action === 'create_block') result = await createAvailabilityBlock({ ...scope(body), source: 'operator', reason: String(body.reason ?? '').slice(0, 500) });
    else if (action === 'release_block') result = await releaseAvailabilityBlock(value(body, 'blockId', 'block_id') ?? '');
    else if (action === 'mark_needs_review') {
      const bookingId = value(body, 'bookingId', 'booking_id');
      if (!bookingId) throw new Error('Укажите ID брони.');
      const { data, error } = await supabase.from('booking_ops_records').update({
        overbooking_risk_status: 'needs_review', availability_status: 'blocked', updated_at: new Date().toISOString(),
      }).eq('id', bookingId).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      result = data;
    } else {
      const checkId = value(body, 'checkId', 'check_id');
      const note = String(body.note ?? '').trim().slice(0, 500);
      if (!checkId || !SAFE_ID.test(checkId) || !note) throw new Error('Укажите проверку и заметку.');
      const { data: existing, error: readError } = await supabase.from('booking_overbooking_conflict_checks').select('warnings').eq('id', checkId).maybeSingle();
      if (readError || !existing) throw new Error(readError?.message ?? 'Проверка не найдена.');
      const warnings = Array.isArray(existing.warnings) ? existing.warnings.map(String) : [];
      const { data, error } = await supabase.from('booking_overbooking_conflict_checks')
        .update({ warnings: [...warnings, note], updated_at: new Date().toISOString() }).eq('id', checkId).select('id,warnings').single();
      if (error) throw new Error(error.message);
      result = data;
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}
