import { buildChannelManagerConnectionHref } from '@/lib/channel-manager-connection/flow';
import { listCrmContacts } from '@/lib/crm/repository';
import type { CrmContact } from '@/lib/crm/types';
import { looksLikeTechnicalPropertyId, text } from '@/lib/pilot-data/test-markers';
import { supabase } from '@/lib/supabase';
import type { PilotObjectSnapshot, PilotPropertyRow } from './types';

type KnowledgeValueMap = Record<string, string>;

const KNOWLEDGE_KEYS = [
  'object_name',
  'address',
  'description',
  'house_rules_text',
  'check_in_time',
  'check_out_time',
  'wifi_name',
  'wifi_password',
  'check_in_text',
  'booking_channels',
] as const;

export function resolveObjectDisplayLabel(input: {
  propertyId: string;
  objectName?: string | null;
  crmTitle?: string | null;
  ownerName?: string | null;
}): string {
  const propertyId = text(input.propertyId);
  const objectName = text(input.objectName);
  if (objectName && !looksLikeTechnicalPropertyId(objectName)) return objectName;

  const crmTitle = text(input.crmTitle);
  if (crmTitle) return crmTitle;

  const ownerName = text(input.ownerName);
  if (ownerName) return `Объект ${ownerName}`;

  if (propertyId && !looksLikeTechnicalPropertyId(propertyId)) return propertyId;
  return 'Объект без названия';
}

export function buildObjectPassportHref(input: {
  propertyId: string;
  contactId?: string | null;
}): string {
  const propertyId = text(input.propertyId);
  if (!propertyId) return '/dashboard/properties';
  return buildChannelManagerConnectionHref({
    objectId: propertyId,
    contactId: input.contactId,
    source: 'pilot_readiness',
  });
}

export function contactMapsFromContacts(contacts: CrmContact[]): {
  byObjectId: Map<string, { contactId: string; ownerName: string; title: string | null }>;
  bridgedObjectIds: string[];
} {
  const byObjectId = new Map<string, { contactId: string; ownerName: string; title: string | null }>();
  const bridgedObjectIds: string[] = [];

  for (const contact of contacts) {
    if (contact.crmArchived) continue;
    for (const object of contact.ownerObjects ?? []) {
      const objectId = text(object.objectId);
      if (!objectId) continue;
      if (!byObjectId.has(objectId)) {
        bridgedObjectIds.push(objectId);
        byObjectId.set(objectId, {
          contactId: contact.id,
          ownerName: contact.name,
          title: text(object.title) || text(contact.activeObjectTitle) || null,
        });
      }
    }
  }

  return { byObjectId, bridgedObjectIds };
}

async function loadKnowledgeValuesForObjects(objectIds: string[]): Promise<Map<string, KnowledgeValueMap>> {
  const map = new Map<string, KnowledgeValueMap>();
  if (objectIds.length === 0) return map;

  const { data, error } = await supabase
    .from('object_knowledge_entries')
    .select('object_id,key,value_text')
    .in('object_id', objectIds.slice(0, 100))
    .in('key', [...KNOWLEDGE_KEYS])
    .limit(500);

  if (error || !data) return map;

  for (const row of data as Array<{ object_id?: string; key?: string; value_text?: string | null }>) {
    const objectId = text(row.object_id);
    const key = text(row.key);
    const value = text(row.value_text);
    if (!objectId || !key || !value) continue;
    const bucket = map.get(objectId) ?? {};
    if (!bucket[key]) bucket[key] = value;
    map.set(objectId, bucket);
  }

  return map;
}

function applyKnowledgeToRow(row: PilotPropertyRow, knowledge: KnowledgeValueMap): PilotPropertyRow {
  return {
    ...row,
    object_name: text(row.object_name) || knowledge.object_name || row.object_name,
    address: text(row.address) || text(row.location) || knowledge.address || row.address,
    description: text(row.description) || knowledge.description || row.description,
    house_rules_text:
      text(row.house_rules_text) || text(row.house_rules) || knowledge.house_rules_text || row.house_rules_text,
    check_in_time: text(row.check_in_time) || knowledge.check_in_time || row.check_in_time,
    check_out_time: text(row.check_out_time) || knowledge.checkout_time || row.check_out_time,
    wifi_name: text(row.wifi_name) || knowledge.wifi_name || row.wifi_name,
    wifi_password: text(row.wifi_password) || knowledge.wifi_password || row.wifi_password,
    access_notes: text(row.access_notes) || knowledge.check_in_text || row.access_notes,
    booking_channels: text(row.booking_channels) || knowledge.booking_channels || row.booking_channels,
  };
}

export function snapshotFromPassportSources(input: {
  row: PilotPropertyRow | null;
  propertyId: string;
  photosCount: number;
  contact?: { contactId: string; ownerName: string; title: string | null } | null;
  knowledge?: KnowledgeValueMap;
}): PilotObjectSnapshot {
  const propertyId = text(input.propertyId);
  const mergedRow = applyKnowledgeToRow(
    input.row ?? { property_id: propertyId, active: true },
    input.knowledge ?? {},
  );
  const crmTitle = input.contact?.title ?? null;
  const resolvedName = resolveObjectDisplayLabel({
    propertyId,
    objectName: mergedRow.object_name,
    crmTitle,
    ownerName: input.contact?.ownerName ?? null,
  });

  return {
    propertyId,
    objectLabel: resolvedName,
    name: text(mergedRow.object_name) || crmTitle || null,
    address: text(mergedRow.address) || text(mergedRow.location) || text(input.knowledge?.address) || null,
    description: text(mergedRow.description) || text(input.knowledge?.description) || null,
    rules:
      text(mergedRow.house_rules_text)
      || text(mergedRow.house_rules)
      || text(input.knowledge?.house_rules_text)
      || null,
    checkInTime: text(mergedRow.check_in_time) || text(input.knowledge?.check_in_time) || null,
    checkOutTime: text(mergedRow.check_out_time) || text(input.knowledge?.checkout_time) || null,
    wifiName: text(mergedRow.wifi_name) || text(input.knowledge?.wifi_name) || null,
    wifiPassword: text(mergedRow.wifi_password) || text(input.knowledge?.wifi_password) || null,
    wifiSkipped: false,
    accessNotes: text(mergedRow.access_notes) || text(input.knowledge?.check_in_text) || null,
    checkinInstructions: text(mergedRow.checkin_instructions) || null,
    photosDeferred: Boolean(mergedRow.photos_deferred),
    photosCount: input.photosCount,
    bookingChannels: text(mergedRow.booking_channels) || text(input.knowledge?.booking_channels) || null,
    communicationMode: text(mergedRow.communication_autopilot) || 'disabled',
    contactId: input.contact?.contactId ?? null,
    ownerName: input.contact?.ownerName ?? null,
  };
}

export async function enrichSnapshotsWithPassportData(
  rows: PilotPropertyRow[],
  contacts?: CrmContact[],
): Promise<PilotObjectSnapshot[]> {
  const contactList = contacts ?? (await listCrmContacts({ excludeArchived: true }));
  const { byObjectId, bridgedObjectIds } = contactMapsFromContacts(contactList);
  const knownIds = new Set(rows.map((row) => text(row.property_id)).filter(Boolean));
  const allIds = [...knownIds, ...bridgedObjectIds.filter((id) => !knownIds.has(id))];
  const knowledgeMap = await loadKnowledgeValuesForObjects(allIds);
  const snapshots: PilotObjectSnapshot[] = [];

  for (const row of rows) {
    const propertyId = text(row.property_id);
    if (!propertyId) continue;
    snapshots.push(
      snapshotFromPassportSources({
        row,
        propertyId,
        photosCount: 0,
        contact: byObjectId.get(propertyId) ?? null,
        knowledge: knowledgeMap.get(propertyId),
      }),
    );
  }

  for (const propertyId of bridgedObjectIds) {
    if (knownIds.has(propertyId)) continue;
    snapshots.push(
      snapshotFromPassportSources({
        row: null,
        propertyId,
        photosCount: 0,
        contact: byObjectId.get(propertyId) ?? null,
        knowledge: knowledgeMap.get(propertyId),
      }),
    );
  }

  return snapshots;
}
