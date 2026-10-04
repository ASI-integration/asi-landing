import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import {
  requireBookingOpsApiAvailabilityBlockAccess,
  requireBookingOpsApiAvailabilityCheckAccess,
  requireBookingOpsApiAvailabilityHoldAccess,
  requireBookingOpsApiAvailabilityScopeAccess,
} from '@/app/api/dashboard/booking-ops/access';
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
    const requested = scope(body);
    const holdId = value(body, 'holdId', 'hold_id') ?? '';
    const blockId = value(body, 'blockId', 'block_id') ?? '';
    const access = action === 'add_note'
      ? null
      : action === 'release_hold' || action === 'confirm_hold'
        ? await requireBookingOpsApiAvailabilityHoldAccess(auth.session, holdId)
        : action === 'release_block'
          ? await requireBookingOpsApiAvailabilityBlockAccess(auth.session, blockId)
          : await requireBookingOpsApiAvailabilityScopeAccess(auth.session, requested);
    if (access && !access.ok) return access.response;
    const canonicalScope = access?.ok ? {
      bookingId: access.bookingId,
      propertySetupId: access.propertySetupId,
      propertyId: access.propertyId,
      dateFrom: requested.dateFrom,
      dateTo: requested.dateTo,
    } : requested;
    const accountId = access?.ok ? access.accountId : '';
    const expectedEntityScope = {
      propertyId: canonicalScope.propertyId,
      propertySetupId: canonicalScope.propertySetupId,
    };

    if (action === 'check_conflict') result = await checkAvailabilityConflict(
      canonicalScope, { checkType: 'manual_review', accountId },
    );
    else if (action === 'create_hold') result = await createAvailabilityHold(
      { ...canonicalScope, source: 'operator', holdMinutes: Number(body.holdMinutes ?? 30) },
      { accountId },
    );
    else if (action === 'release_hold') result = await releaseAvailabilityHold(
      holdId, undefined, accountId, expectedEntityScope,
    );
    else if (action === 'confirm_hold') {
      let bookingId = canonicalScope.bookingId;
      if (requested.bookingId && requested.bookingId !== bookingId) {
        const bookingAccess = await requireBookingOpsApiAvailabilityScopeAccess(auth.session, {
          bookingId: requested.bookingId,
          propertyId: canonicalScope.propertyId,
        });
        if (!bookingAccess.ok) return bookingAccess.response;
        bookingId = bookingAccess.bookingId;
      }
      result = await confirmAvailabilityHold(
        holdId, bookingId ?? undefined, undefined, accountId, expectedEntityScope,
      );
    } else if (action === 'expire_holds') result = await expireAvailabilityHolds({
      propertyId: canonicalScope.propertyId ?? undefined, accountId,
    });
    else if (action === 'create_block') result = await createAvailabilityBlock(
      { ...canonicalScope, source: 'operator', reason: String(body.reason ?? '').slice(0, 500) },
      undefined,
      accountId,
    );
    else if (action === 'release_block') result = await releaseAvailabilityBlock(
      blockId, undefined, accountId, expectedEntityScope,
    );
    else if (action === 'mark_needs_review') {
      const bookingId = canonicalScope.bookingId;
      const propertyId = canonicalScope.propertyId;
      if (!bookingId) throw new Error('Укажите ID брони.');
      if (!propertyId) throw new Error('property_scope_mismatch');
      const { data, error } = await supabase.from('booking_ops_records').update({
        overbooking_risk_status: 'needs_review', availability_status: 'blocked', updated_at: new Date().toISOString(),
      }).eq('id', bookingId).eq('account_id', accountId).eq('property_id', propertyId).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Бронирование не найдено.');
      result = data;
    } else {
      const checkId = value(body, 'checkId', 'check_id');
      const note = String(body.note ?? '').trim().slice(0, 500);
      if (!checkId || !SAFE_ID.test(checkId) || !note) throw new Error('Укажите проверку и заметку.');
      const checkAccess = await requireBookingOpsApiAvailabilityCheckAccess(auth.session, checkId);
      if (!checkAccess.ok) return checkAccess.response;
      const { data: existing, error: readError } = await supabase.from('booking_overbooking_conflict_checks')
        .select('warnings').eq('id', checkAccess.checkId).eq('account_id', checkAccess.accountId).maybeSingle();
      if (readError || !existing) throw new Error(readError?.message ?? 'Проверка не найдена.');
      const warnings = Array.isArray(existing.warnings) ? existing.warnings.map(String) : [];
      const { data, error } = await supabase.from('booking_overbooking_conflict_checks')
        .update({ warnings: [...warnings, note], updated_at: new Date().toISOString() })
        .eq('id', checkAccess.checkId).eq('account_id', checkAccess.accountId).select('id,warnings').single();
      if (error) throw new Error(error.message);
      result = data;
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}
