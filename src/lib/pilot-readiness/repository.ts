import { listCrmContacts } from '@/lib/crm/repository';
import { isPilotAcceptanceProperty, text } from '@/lib/pilot-data/test-markers';
import { supabase } from '@/lib/supabase';
import { computePilotReadiness } from './engine';
import { enrichSnapshotsWithPassportData } from './passport-bridge';
import type { PilotObjectSnapshot, PilotPropertyRow, PilotReadinessResult } from './types';

async function countPhotosForProperty(propertyId: string): Promise<number> {
  const { count, error } = await supabase
    .from('object_knowledge_entries')
    .select('entry_id', { count: 'exact', head: true })
    .eq('object_id', propertyId)
    .eq('category', 'media');

  if (error) return 0;
  return count ?? 0;
}

async function attachPhotoCounts(snapshots: PilotObjectSnapshot[]): Promise<PilotObjectSnapshot[]> {
  const enriched: PilotObjectSnapshot[] = [];
  for (const snapshot of snapshots) {
    const photosCount = await countPhotosForProperty(snapshot.propertyId);
    enriched.push({ ...snapshot, photosCount });
  }
  return enriched;
}

function filterSnapshots(
  snapshots: PilotObjectSnapshot[],
  rows: PilotPropertyRow[],
  options?: { includeTest?: boolean },
): PilotObjectSnapshot[] {
  if (options?.includeTest) return snapshots;
  const markerById = new Map(
    rows.map((row) => [text(row.property_id), text(row.pilot_acceptance_marker) || null]),
  );
  return snapshots.filter((snapshot) => {
    const marker = markerById.get(snapshot.propertyId) ?? null;
    return !isPilotAcceptanceProperty({
      propertyId: snapshot.propertyId,
      pilotAcceptanceMarker: marker,
    });
  });
}

export async function loadPilotObjectSnapshot(propertyId: string): Promise<PilotObjectSnapshot | null> {
  const id = text(propertyId);
  if (!id) return null;

  const [{ data, error }, contacts] = await Promise.all([
    supabase.from('tg_property_knowledge').select('*').eq('property_id', id).maybeSingle(),
    listCrmContacts({ excludeArchived: true }),
  ]);

  if (error) return null;
  const rows = data ? [data as PilotPropertyRow] : [];
  const snapshots = await enrichSnapshotsWithPassportData(rows, contacts);
  const match = snapshots.find((item) => item.propertyId === id);
  if (!match) return null;
  const [withPhotos] = await attachPhotoCounts([match]);
  return withPhotos;
}

export async function listPilotObjectSnapshots(options?: {
  includeTest?: boolean;
}): Promise<PilotObjectSnapshot[]> {
  const [{ data, error }, contacts] = await Promise.all([
    supabase.from('tg_property_knowledge').select('*').eq('active', true).limit(200),
    listCrmContacts({ excludeArchived: true }),
  ]);

  const rows = error || !data ? [] : (data as PilotPropertyRow[]);
  const snapshots = await enrichSnapshotsWithPassportData(rows, contacts);
  const withPhotos = await attachPhotoCounts(snapshots);
  return filterSnapshots(withPhotos, rows, options);
}

export async function listPilotReadinessResults(options?: {
  includeTest?: boolean;
}): Promise<PilotReadinessResult[]> {
  const snapshots = await listPilotObjectSnapshots(options);
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

export type { PilotPropertyRow } from './types';
