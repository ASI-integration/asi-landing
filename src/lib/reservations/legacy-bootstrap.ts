import { auditReservationMutation } from '@/lib/reservations/ledger';
import { supabase } from '@/lib/supabase';

const safeColumns = 'id,asi_reference,property_label,property_id,check_in_at,check_out_at';

export async function previewLegacyReservations(targetAccountId: string) {
  if (!targetAccountId) throw new Error('target_account_required');
  const account = await supabase.from('accounts').select('id').eq('id', targetAccountId).maybeSingle();
  if (account.error) throw new Error(account.error.message);
  if (!account.data) throw new Error('target_account_not_found');
  const result = await supabase.from('booking_ops_records').select(safeColumns).is('account_id', null).order('check_in_at');
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({
    id: row.id,
    asiReference: row.asi_reference,
    propertyLabel: row.property_label ?? row.property_id ?? 'Объект не указан',
    checkIn: row.check_in_at,
    checkOut: row.check_out_at,
  }));
}

export async function assignLegacyReservations(input: { targetAccountId: string; selectedIds: string[]; actorId: string; confirm: boolean }) {
  if (!input.confirm) throw new Error('explicit_confirmation_required');
  const selectedIds = [...new Set(input.selectedIds.filter(Boolean))];
  if (!input.targetAccountId) throw new Error('target_account_required');
  if (selectedIds.length === 0) throw new Error('selected_reservations_required');
  const preview = await previewLegacyReservations(input.targetAccountId);
  const eligible = new Set(preview.map((row) => row.id));
  const selected = selectedIds.filter((id) => eligible.has(id));
  let assigned = 0;
  for (const id of selected) {
    const saved = await supabase.from('booking_ops_records').update({ account_id: input.targetAccountId, updated_at: new Date().toISOString() }).eq('id', id).is('account_id', null).select('id').maybeSingle();
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data) continue;
    assigned += 1;
    await auditReservationMutation({ accountId: input.targetAccountId, actorId: input.actorId, reservationId: id, action: 'legacy_reservation_assigned', before: { accountId: null }, after: { accountId: input.targetAccountId } });
  }
  return { requested: selectedIds.length, eligible: selected.length, assigned, alreadyAssignedOrUnavailable: selectedIds.length - assigned };
}
