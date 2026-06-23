import { listCrmContacts } from '@/lib/crm/repository';
import { supabase } from '@/lib/supabase';
import { computePilotReadiness } from './engine';
import type { PilotObjectSnapshot, PilotReadinessResult } from './types';

export type PilotPropertyRow = {
  property_id: string;
  object_name?: string | null;
  address?: string | null;
  location?: string | null;
  description?: string | null;
  house_rules?: string | null;
  house_rules_text?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  wifi_name?: string | null;
  wifi_password?: string | null;
  access_notes?: string | null;
  checkin_instructions?: string | null;
  booking_channels?: string | null;
  communication_autopilot?: string | null;
  photos_deferred?: boolean | null;
  active?: boolean | null;
  pilot_acceptance_marker?: string | null;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

async function countPhotosForProperty(propertyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('object_knowledge_entries')
    .select('entry_id', { count: 'exact', head: true })
    .eq('object_id', propertyId)
    .eq('category', 'media');

  if (error) return 0;
  return count ?? 0;
}

function snapshotFromRow(
  row: PilotPropertyRow,
  extras: {
    photosCount: number;
    contactId: string | null;
    ownerName: string | null;
  },
): PilotObjectSnapshot {
  const propertyId = text(row.property_id);
  const name = text(row.object_name) || null;
  return {
    propertyId,
    objectLabel: name,
    name,
    address: text(row.address) || text(row.location) || null,
    description: text(row.description) || null,
    rules: text(row.house_rules_text) || text(row.house_rules) || null,
    checkInTime: text(row.check_in_time) || null,
    checkOutTime: text(row.check_out_time) || null,
    wifiName: text(row.wifi_name) || null,
    wifiPassword: text(row.wifi_password) || null,
    wifiSkipped: false,
    accessNotes: text(row.access_notes) || null,
    checkinInstructions: text(row.checkin_instructions) || null,
    photosDeferred: Boolean(row.photos_deferred),
    photosCount: extras.photosCount,
    bookingChannels: text(row.booking_channels) || null,
    communicationMode: text(row.communication_autopilot) || 'disabled',
    contactId: extras.contactId,
    ownerName: extras.ownerName,
  };
}

function contactByObjectId(
  contacts: Awaited<ReturnType<typeof listCrmContacts>>,
): Map<string, { contactId: string; ownerName: string }> {
  const map = new Map<string, { contactId: string; ownerName: string }>();
  for (const contact of contacts) {
    if (contact.crmArchived) continue;
    for (const object of contact.ownerObjects ?? []) {
      const objectId = text(object.objectId);
      if (!objectId || map.has(objectId)) continue;
      map.set(objectId, { contactId: contact.id, ownerName: contact.name });
    }
  }
  return map;
}

export async function loadPilotObjectSnapshot(propertyId: string): Promise<PilotObjectSnapshot | null> {
  const id = text(propertyId);
  if (!id) return null;

  const [{ data, error }, contacts, photosCount] = await Promise.all([
    supabase.from('tg_property_knowledge').select('*').eq('property_id', id).maybeSingle(),
    listCrmContacts({ excludeArchived: true }),
    countPhotosForProperty(id),
  ]);

  if (error || !data) return null;

  const contactMap = contactByObjectId(contacts);
  const linked = contactMap.get(id) ?? { contactId: null, ownerName: null };

  return snapshotFromRow(data as PilotPropertyRow, {
    photosCount,
    contactId: linked.contactId,
    ownerName: linked.ownerName,
  });
}

export async function listPilotObjectSnapshots(): Promise<PilotObjectSnapshot[]> {
  const [{ data, error }, contacts] = await Promise.all([
    supabase.from('tg_property_knowledge').select('*').eq('active', true).limit(200),
    listCrmContacts({ excludeArchived: true }),
  ]);

  if (error || !data) return [];

  const contactMap = contactByObjectId(contacts);
  const rows = data as PilotPropertyRow[];
  const snapshots: PilotObjectSnapshot[] = [];

  for (const row of rows) {
    const propertyId = text(row.property_id);
    if (!propertyId) continue;
    const photosCount = await countPhotosForProperty(propertyId);
    const linked = contactMap.get(propertyId) ?? { contactId: null, ownerName: null };
    snapshots.push(
      snapshotFromRow(row, {
        photosCount,
        contactId: linked.contactId,
        ownerName: linked.ownerName,
      }),
    );
  }

  return snapshots;
}

export async function listPilotReadinessResults(): Promise<PilotReadinessResult[]> {
  const snapshots = await listPilotObjectSnapshots();
  return snapshots.map((snapshot) => computePilotReadiness(snapshot));
}

export async function getPilotReadinessForProperty(propertyId: string): Promise<PilotReadinessResult | null> {
  const snapshot = await loadPilotObjectSnapshot(propertyId);
  if (!snapshot) return null;
  return computePilotReadiness(snapshot);
}

export async function upsertPilotObjectKnowledge(
  input: Partial<PilotPropertyRow> & { property_id: string },
): Promise<{ ok: boolean; error?: string }> {
  const propertyId = text(input.property_id);
  if (!propertyId) return { ok: false, error: 'property_id_required' };

  const row = {
    ...input,
    property_id: propertyId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('tg_property_knowledge').upsert(row, {
    onConflict: 'property_id',
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
