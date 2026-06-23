import { supabase } from '@/lib/supabase';
import { closeEscalationReview, listEscalationReviews } from '@/lib/communication/operator-review';
import { TELEGRAM_OPS_ACCEPTANCE_PREFIX } from '@/lib/communication/telegram-ops-acceptance-shared';
import { PILOT_ACCEPTANCE_PREFIX } from './types';

export type PilotCleanupResult = {
  ok: boolean;
  archived: {
    properties: number;
    bookings: number;
    opsTasks: number;
    crmContacts: number;
    escalationReviews: number;
  };
  errors: string[];
};

const ACCEPTANCE_MARKERS = [
  PILOT_ACCEPTANCE_PREFIX,
  TELEGRAM_OPS_ACCEPTANCE_PREFIX,
  'ASI_OPS_ACCEPTANCE_',
];

function matchesAcceptanceMarker(value: string | null | undefined): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return ACCEPTANCE_MARKERS.some((marker) => text.includes(marker));
}

async function archiveOpsTasksByMarker(marker: string): Promise<number> {
  const { data, error } = await supabase
    .from('ops_operator_tasks')
    .select('id,metadata,description')
    .in('task_status', ['new', 'in_progress', 'needs_operator', 'waiting_owner'])
    .limit(500);

  if (error || !data) return 0;

  let archived = 0;
  for (const row of data as Array<{ id: string; metadata?: Record<string, unknown>; description?: string }>) {
    const haystack = JSON.stringify(row.metadata ?? {}) + String(row.description ?? '');
    if (!haystack.includes(marker)) continue;
    const { error: updateError } = await supabase
      .from('ops_operator_tasks')
      .update({ task_status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', row.id);
    if (!updateError) archived += 1;
  }
  return archived;
}

export async function cleanupPilotAcceptanceData(marker?: string): Promise<PilotCleanupResult> {
  const targetMarker = String(marker ?? PILOT_ACCEPTANCE_PREFIX).trim();
  const errors: string[] = [];
  const archived = {
    properties: 0,
    bookings: 0,
    opsTasks: 0,
    crmContacts: 0,
    escalationReviews: 0,
  };

  const { data: properties, error: propertiesError } = await supabase
    .from('tg_property_knowledge')
    .select('property_id,pilot_acceptance_marker')
    .or(`pilot_acceptance_marker.ilike.%${targetMarker}%`);

  if (propertiesError) {
    errors.push(`properties: ${propertiesError.message}`);
  } else {
    for (const row of properties ?? []) {
      const propertyId = String((row as { property_id?: string }).property_id ?? '');
      if (!propertyId) continue;
      const { error } = await supabase.from('tg_property_knowledge').delete().eq('property_id', propertyId);
      if (error) errors.push(`property ${propertyId}: ${error.message}`);
      else archived.properties += 1;
    }
  }

  const { data: bookings, error: bookingsError } = await supabase
    .from('tg_guest_reservations')
    .select('id,pilot_acceptance_marker,reservation_ref')
    .or(`pilot_acceptance_marker.ilike.%${targetMarker}%,reservation_ref.ilike.%${targetMarker}%`);

  if (bookingsError) {
    errors.push(`bookings: ${bookingsError.message}`);
  } else {
    for (const row of bookings ?? []) {
      const id = String((row as { id?: string }).id ?? '');
      if (!id) continue;
      const { error } = await supabase
        .from('tg_guest_reservations')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) errors.push(`booking ${id}: ${error.message}`);
      else archived.bookings += 1;
    }
  }

  try {
    archived.opsTasks = await archiveOpsTasksByMarker(targetMarker);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`ops_tasks: ${detail}`);
  }

  const { data: contacts, error: contactsError } = await supabase
    .from('crm_contacts')
    .select('id,name,notes')
    .or(`name.ilike.%${targetMarker}%,notes.ilike.%${targetMarker}%`)
    .limit(200);

  if (contactsError) {
    errors.push(`crm_contacts: ${contactsError.message}`);
  } else {
    for (const row of contacts ?? []) {
      const id = String((row as { id?: string }).id ?? '');
      const name = String((row as { name?: string }).name ?? '');
      if (!id || !matchesAcceptanceMarker(name)) continue;
      const { error } = await supabase
        .from('crm_contacts')
        .update({ crm_archived: true, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) errors.push(`contact ${id}: ${error.message}`);
      else archived.crmContacts += 1;
    }
  }

  const reviews = listEscalationReviews({ status: 'pending', limit: 200 });
  for (const review of reviews) {
    const haystack = [review.detail, review.suggestedReply, ...review.latestMessages.map((m) => m.content)].join('\n');
    if (!matchesAcceptanceMarker(haystack)) continue;
    try {
      closeEscalationReview(review.reviewId, 'pilot_acceptance_cleanup');
      archived.escalationReviews += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`review ${review.reviewId}: ${detail}`);
    }
  }

  return { ok: errors.length === 0, archived, errors };
}
