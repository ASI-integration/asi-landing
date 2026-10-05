import { auditReservationMutation } from '@/lib/reservations/ledger';
import { supabase } from '@/lib/supabase';

const safeColumns = 'id,asi_reference,property_label,property_id,check_in_at,check_out_at';

export async function previewLegacyReservations(targetAccountId: string) {
  if (!targetAccountId) throw new Error('target_account_required');
  const account = await supabase.from('accounts').select('id').eq('id', targetAccountId).maybeSingle();
  if (account.error) throw new Error(account.error.message);
  if (!account.data) throw new Error('target_account_not_found');
  const properties = await supabase.from('properties').select('id').eq('account_id', targetAccountId);
  if (properties.error) throw new Error(properties.error.message);
  const ownedPropertyIds = (properties.data ?? []).map((row) => String(row.id)).filter(Boolean);
  if (ownedPropertyIds.length === 0) return [];
  const result = await supabase.from('booking_ops_records')
    .select(safeColumns)
    .is('account_id', null)
    .in('property_id', ownedPropertyIds)
    .order('check_in_at');
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((row) => ({
    id: row.id,
    asiReference: row.asi_reference,
    propertyId: row.property_id,
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
  const eligible = new Map(preview.map((row) => [row.id, String(row.propertyId)]));
  const selected = selectedIds.filter((id) => eligible.has(id));
  let assigned = 0;
  for (const id of selected) {
    const propertyId = eligible.get(id);
    if (!propertyId) continue;
    const property = await supabase.from('properties')
      .select('id')
      .eq('id', propertyId)
      .eq('account_id', input.targetAccountId)
      .maybeSingle();
    if (property.error) throw new Error(property.error.message);
    if (!property.data) continue;
    const saved = await supabase.from('booking_ops_records')
      .update({ account_id: input.targetAccountId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('account_id', null)
      .eq('property_id', propertyId)
      .select('id')
      .maybeSingle();
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data) continue;
    assigned += 1;
    await auditReservationMutation({ accountId: input.targetAccountId, actorId: input.actorId, reservationId: id, action: 'legacy_reservation_assigned', before: { accountId: null, propertyId }, after: { accountId: input.targetAccountId, propertyId } });
  }
  return { requested: selectedIds.length, eligible: selected.length, assigned, alreadyAssignedOrUnavailable: selectedIds.length - assigned };
}
