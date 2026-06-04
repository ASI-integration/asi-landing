import { supabase } from '@/lib/supabase';
import { maskedPreview } from './audit';

type SupabaseLike = { from: (table: string) => any };

export type ObjectKnowledgeCategory =
  | 'access'
  | 'directions'
  | 'waste'
  | 'parking'
  | 'wifi'
  | 'baby_crib'
  | 'sleeping_places'
  | 'amenities'
  | 'house_rules'
  | 'checkout'
  | 'maintenance'
  | 'media'
  | 'listing'
  | 'operations';

export type ObjectKnowledgeVisibility =
  | 'guest_public'
  | 'guest_after_booking_verified'
  | 'operator_only'
  | 'internal'
  | 'sensitive';

export type ObjectKnowledgeSensitivity =
  | 'normal'
  | 'personal_data'
  | 'access_code'
  | 'password'
  | 'private_link';

export type ObjectKnowledgeSourceType =
  | 'owner'
  | 'manager'
  | 'cleaner'
  | 'operator'
  | 'guest_report'
  | 'ota'
  | 'photo'
  | 'system'
  | 'unknown';

export type ObjectKnowledgeConfidence = 'high' | 'medium' | 'low' | 'unknown';

export type ObjectKnowledgeStatus =
  | 'found'
  | 'missing'
  | 'stale'
  | 'low_confidence'
  | 'blocked_sensitive';

export type ObjectKnowledgeEntry = {
  entry_id?: string;
  object_id: string;
  property_id?: string | null;
  category: ObjectKnowledgeCategory;
  key: string;
  value_text: string | null;
  value_json?: Record<string, unknown> | null;
  visibility: ObjectKnowledgeVisibility;
  sensitivity: ObjectKnowledgeSensitivity;
  source_type: ObjectKnowledgeSourceType;
  source_ref?: string | null;
  confidence: ObjectKnowledgeConfidence;
  last_verified_at?: string | null;
  stale_after_days?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ObjectKnowledgeLookupResult = {
  status: ObjectKnowledgeStatus;
  entry: ObjectKnowledgeEntry | null;
  reason?: string;
};

export type ObjectKnowledgeReplyAudit = {
  message_id: string;
  object_id?: string | null;
  intent: string;
  knowledge_key: string;
  knowledge_found: boolean;
  knowledge_status: ObjectKnowledgeStatus;
  source_type?: ObjectKnowledgeSourceType | null;
  confidence?: ObjectKnowledgeConfidence | null;
  last_verified_at?: string | null;
  reply_source: 'object_knowledge' | 'fallback' | 'operator_review';
  guest_reply_redacted?: string | null;
};

const SENSITIVE_VISIBILITIES = new Set<ObjectKnowledgeVisibility>([
  'operator_only',
  'internal',
  'sensitive',
]);

const SENSITIVE_KINDS = new Set<ObjectKnowledgeSensitivity>([
  'personal_data',
  'access_code',
  'password',
  'private_link',
]);

async function maybeRows(q: any): Promise<any[]> {
  try {
    const response = typeof q?.then === 'function' ? await q : await Promise.resolve(q);
    const data = (response as any)?.data;
    return Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  } catch {
    return [];
  }
}

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const text = String(v).trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapEntryRow(row: any): ObjectKnowledgeEntry {
  return {
    entry_id: stringOrNull(row?.entry_id) ?? undefined,
    object_id: String(row?.object_id ?? row?.property_id ?? ''),
    property_id: stringOrNull(row?.property_id),
    category: String(row?.category ?? 'operations') as ObjectKnowledgeCategory,
    key: String(row?.key ?? ''),
    value_text: stringOrNull(row?.value_text),
    value_json: row?.value_json && typeof row.value_json === 'object' ? row.value_json : null,
    visibility: String(row?.visibility ?? 'internal') as ObjectKnowledgeVisibility,
    sensitivity: String(row?.sensitivity ?? 'normal') as ObjectKnowledgeSensitivity,
    source_type: String(row?.source_type ?? 'unknown') as ObjectKnowledgeSourceType,
    source_ref: stringOrNull(row?.source_ref),
    confidence: String(row?.confidence ?? 'unknown') as ObjectKnowledgeConfidence,
    last_verified_at: stringOrNull(row?.last_verified_at),
    stale_after_days: numberOrNull(row?.stale_after_days),
    valid_from: stringOrNull(row?.valid_from),
    valid_to: stringOrNull(row?.valid_to),
    updated_by: stringOrNull(row?.updated_by),
    created_at: stringOrNull(row?.created_at) ?? undefined,
    updated_at: stringOrNull(row?.updated_at) ?? undefined,
  };
}

export function is_stale(entry: ObjectKnowledgeEntry, now: Date = new Date()): boolean {
  const validFrom = entry.valid_from ? new Date(entry.valid_from) : null;
  if (validFrom && Number.isFinite(validFrom.getTime()) && validFrom.getTime() > now.getTime()) return true;

  const validTo = entry.valid_to ? new Date(entry.valid_to) : null;
  if (validTo && Number.isFinite(validTo.getTime()) && validTo.getTime() < now.getTime()) return true;

  if (!entry.last_verified_at || !entry.stale_after_days) return false;
  const verifiedAt = new Date(entry.last_verified_at);
  if (!Number.isFinite(verifiedAt.getTime())) return false;
  const staleAt = verifiedAt.getTime() + entry.stale_after_days * 24 * 60 * 60 * 1000;
  return staleAt < now.getTime();
}

export function can_show_to_guest(entry: ObjectKnowledgeEntry, booking_verified: boolean): boolean {
  if (entry.visibility === 'guest_public' && entry.sensitivity === 'normal') return true;
  if (entry.visibility === 'guest_after_booking_verified' && booking_verified) return true;
  if (SENSITIVE_VISIBILITIES.has(entry.visibility)) return false;
  if (SENSITIVE_KINDS.has(entry.sensitivity) && !booking_verified) return false;
  return entry.visibility === 'guest_public';
}

function statusForEntry(entry: ObjectKnowledgeEntry, bookingVerified: boolean, now?: Date): ObjectKnowledgeStatus {
  if (!can_show_to_guest(entry, bookingVerified)) return 'blocked_sensitive';
  if (is_stale(entry, now)) return 'stale';
  if (entry.confidence === 'low') return 'low_confidence';
  return 'found';
}

export async function get_object_knowledge(params: {
  object_id: string;
  key: string;
  db?: SupabaseLike;
}): Promise<ObjectKnowledgeLookupResult> {
  const objectId = String(params.object_id ?? '').trim();
  const key = String(params.key ?? '').trim();
  if (!objectId || !key) return { status: 'missing', entry: null, reason: 'missing_lookup_key' };

  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const queries = [
    db.from('object_knowledge_entries').select('*').eq('object_id', objectId).eq('key', key).order('updated_at', { ascending: false }).limit(1),
    db.from('object_knowledge_entries').select('*').eq('property_id', objectId).eq('key', key).order('updated_at', { ascending: false }).limit(1),
  ];

  for (const query of queries) {
    const rows = await maybeRows(query);
    if (rows[0]) return { status: 'found', entry: mapEntryRow(rows[0]) };
  }

  return { status: 'missing', entry: null };
}

export async function get_object_knowledge_entries(params: {
  object_id: string;
  keys: string[];
  db?: SupabaseLike;
}): Promise<ObjectKnowledgeEntry[]> {
  const objectId = String(params.object_id ?? '').trim();
  const keys = params.keys.map((key) => String(key).trim()).filter(Boolean);
  if (!objectId || keys.length === 0) return [];

  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const byObject = await maybeRows(
    db.from('object_knowledge_entries').select('*').eq('object_id', objectId).in('key', keys).order('updated_at', { ascending: false }),
  );
  const rows =
    byObject.length > 0
      ? byObject
      : await maybeRows(
          db.from('object_knowledge_entries').select('*').eq('property_id', objectId).in('key', keys).order('updated_at', { ascending: false }),
        );

  const seen = new Set<string>();
  const entries: ObjectKnowledgeEntry[] = [];
  for (const row of rows) {
    const entry = mapEntryRow(row);
    if (!entry.key || seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
  }
  return entries;
}

export async function get_guest_visible_knowledge(params: {
  object_id: string;
  key: string;
  booking_verified?: boolean;
  db?: SupabaseLike;
  now?: Date;
}): Promise<ObjectKnowledgeLookupResult> {
  const result = await get_object_knowledge(params);
  if (!result.entry) return result;
  return {
    status: statusForEntry(result.entry, Boolean(params.booking_verified), params.now),
    entry: result.entry,
  };
}

export async function get_fresh_guest_knowledge(params: {
  object_id: string;
  key: string;
  booking_verified?: boolean;
  db?: SupabaseLike;
  now?: Date;
}): Promise<ObjectKnowledgeLookupResult> {
  return get_guest_visible_knowledge(params);
}

function maskObjectId(objectId: string | null | undefined): string | null {
  const raw = String(objectId ?? '').trim();
  if (!raw) return null;
  if (raw.length <= 6) return `${raw.slice(0, 1)}***`;
  return `${raw.slice(0, 3)}***${raw.slice(-2)}`;
}

export function buildObjectKnowledgeReplyAudit(input: ObjectKnowledgeReplyAudit): ObjectKnowledgeReplyAudit {
  return {
    ...input,
    object_id: maskObjectId(input.object_id),
    guest_reply_redacted: maskedPreview(input.guest_reply_redacted ?? undefined, 180) ?? null,
  };
}

export function audit_object_knowledge_reply(input: ObjectKnowledgeReplyAudit): void {
  console.log(JSON.stringify({ object_knowledge_reply_audit: buildObjectKnowledgeReplyAudit(input) }));
}
