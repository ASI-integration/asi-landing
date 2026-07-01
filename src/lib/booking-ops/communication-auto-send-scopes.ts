import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES } from './communication-auto-send-policy';
import type { ActualAutoSendChannel } from './communication-auto-send-executor';

export const AUTO_SEND_SCOPE_TYPES = ['global', 'owner', 'property', 'booking', 'pilot'] as const;
export type AutoSendScopeType = (typeof AUTO_SEND_SCOPE_TYPES)[number];

export type AutoSendScope = {
  id: string;
  scopeType: AutoSendScopeType;
  scopeRef: string | null;
  actualSendEnabled: boolean;
  enabledBy: string | null;
  enabledAt: string | null;
  disabledAt: string | null;
  reason: string | null;
  maxBatchSize: number;
  allowedChannels: ActualAutoSendChannel[];
  allowedMessageTypes: string[];
  dryRunOnly: boolean;
  emergencyStop: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutoSendScopeContext = {
  bookingId?: string | null;
  propertyId?: string | null;
  ownerId?: string | null;
  pilotScopeRef?: string | null;
  channel: ActualAutoSendChannel;
  messageType: string;
};

type ScopeRow = {
  id: string;
  scope_type: AutoSendScopeType;
  scope_ref: string | null;
  actual_send_enabled: boolean;
  enabled_by: string | null;
  enabled_at: string | null;
  disabled_at: string | null;
  reason: string | null;
  max_batch_size: number;
  allowed_channels: unknown;
  allowed_message_types: unknown;
  dry_run_only: boolean;
  emergency_stop: boolean;
  created_at: string;
  updated_at: string;
};

const SAFE_TYPES = new Set<string>(SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES);
const SAFE_CHANNELS = new Set<ActualAutoSendChannel>(['telegram', 'email']);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function mapScope(row: ScopeRow): AutoSendScope {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeRef: row.scope_ref,
    actualSendEnabled: row.actual_send_enabled,
    enabledBy: row.enabled_by,
    enabledAt: row.enabled_at,
    disabledAt: row.disabled_at,
    reason: row.reason,
    maxBatchSize: row.max_batch_size,
    allowedChannels: strings(row.allowed_channels) as ActualAutoSendChannel[],
    allowedMessageTypes: strings(row.allowed_message_types),
    dryRunOnly: row.dry_run_only,
    emergencyStop: row.emergency_stop,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeScopeRef(scopeType: AutoSendScopeType, value: unknown): string | null {
  if (scopeType === 'global') return null;
  const result = String(value ?? '').trim();
  return result && result.length <= 160 ? result : null;
}

export function normalizeScopeConfig(input: {
  maxBatchSize?: unknown;
  allowedChannels?: unknown;
  allowedMessageTypes?: unknown;
}) {
  const requestedChannels = strings(input.allowedChannels);
  const requestedTypes = strings(input.allowedMessageTypes);
  const allowedChannels = (requestedChannels.length ? requestedChannels : ['telegram', 'email'])
    .filter((item): item is ActualAutoSendChannel => SAFE_CHANNELS.has(item as ActualAutoSendChannel));
  const allowedMessageTypes = (requestedTypes.length
    ? requestedTypes
    : [...SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES])
    .filter((item) => SAFE_TYPES.has(item));
  return {
    maxBatchSize: Math.min(Math.max(Number(input.maxBatchSize ?? 10) || 10, 1), 20),
    allowedChannels: [...new Set(allowedChannels)],
    allowedMessageTypes: [...new Set(allowedMessageTypes)],
  };
}

async function readAllScopes(): Promise<AutoSendScope[]> {
  const { data, error } = await supabase
    .from('booking_ops_communication_auto_send_scopes')
    .select('*')
    .order('updated_at', { ascending: false });
  return error ? [] : ((data ?? []) as ScopeRow[]).map(mapScope);
}

export async function listAutoSendScopes(filters: { scopeType?: AutoSendScopeType; scopeRef?: string | null } = {}) {
  const scopes = await readAllScopes();
  return scopes.filter((scope) => {
    if (filters.scopeType && scope.scopeType !== filters.scopeType) return false;
    if (filters.scopeRef !== undefined && scope.scopeRef !== filters.scopeRef) return false;
    return true;
  });
}

export async function setAutoSendScope(input: {
  scopeType: AutoSendScopeType;
  scopeRef?: string | null;
  enabled: boolean;
  enabledBy: string;
  reason?: string | null;
  maxBatchSize?: unknown;
  allowedChannels?: unknown;
  allowedMessageTypes?: unknown;
  dryRunOnly?: boolean;
}) {
  if (input.scopeType === 'global' && input.enabled) {
    return { ok: false as const, error: 'global_enable_forbidden' };
  }
  const scopeRef = normalizeScopeRef(input.scopeType, input.scopeRef);
  if (input.scopeType !== 'global' && !scopeRef) return { ok: false as const, error: 'invalid_scope_ref' };
  const config = normalizeScopeConfig(input);
  if (config.allowedChannels.length === 0 || config.allowedMessageTypes.length === 0) {
    return { ok: false as const, error: 'empty_allowlist' };
  }
  const now = new Date().toISOString();
  const values = {
    id: randomUUID(),
    scope_type: input.scopeType,
    scope_ref: scopeRef,
    actual_send_enabled: input.enabled,
    enabled_by: input.enabled ? input.enabledBy.slice(0, 160) : null,
    enabled_at: input.enabled ? now : null,
    disabled_at: input.enabled ? null : now,
    reason: String(input.reason ?? '').trim().slice(0, 500) || null,
    max_batch_size: config.maxBatchSize,
    allowed_channels: config.allowedChannels,
    allowed_message_types: config.allowedMessageTypes,
    dry_run_only: input.dryRunOnly === true,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_ops_communication_auto_send_scopes')
    .upsert(values, { onConflict: 'scope_type,scope_ref_key', ignoreDuplicates: false })
    .select('*')
    .maybeSingle();
  return error || !data
    ? { ok: false as const, error: error?.message ?? 'scope_update_failed' }
    : { ok: true as const, scope: mapScope(data as ScopeRow) };
}

export async function setGlobalAutoSendEmergencyStop(input: {
  enabled: boolean;
  enabledBy: string;
  reason?: string | null;
}) {
  const scopes = await readAllScopes();
  const global = scopes.find((scope) => scope.scopeType === 'global');
  const now = new Date().toISOString();
  const values = {
    id: global?.id ?? randomUUID(),
    scope_type: 'global',
    scope_ref: null,
    actual_send_enabled: false,
    emergency_stop: input.enabled,
    enabled_by: global?.enabledBy ?? null,
    enabled_at: global?.enabledAt ?? null,
    disabled_at: now,
    reason: String(input.reason ?? '').trim().slice(0, 500) || null,
    max_batch_size: global?.maxBatchSize ?? 10,
    allowed_channels: global?.allowedChannels ?? ['telegram', 'email'],
    allowed_message_types: global?.allowedMessageTypes ?? [...SUPPORTED_ACTUAL_AUTO_SEND_MESSAGE_TYPES],
    dry_run_only: true,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('booking_ops_communication_auto_send_scopes')
    .upsert(values, { onConflict: 'scope_type,scope_ref_key', ignoreDuplicates: false })
    .select('*')
    .maybeSingle();
  return error || !data
    ? { ok: false as const, error: error?.message ?? 'emergency_stop_update_failed' }
    : { ok: true as const, scope: mapScope(data as ScopeRow), changedBy: input.enabledBy };
}

function scopeRank(scope: AutoSendScope, context: AutoSendScopeContext): number {
  if (scope.scopeType === 'booking' && scope.scopeRef === context.bookingId) return 50;
  if (scope.scopeType === 'property' && scope.scopeRef === context.propertyId) return 40;
  if (scope.scopeType === 'owner' && scope.scopeRef === context.ownerId) return 30;
  if (scope.scopeType === 'pilot' && scope.scopeRef === context.pilotScopeRef) return 20;
  return -1;
}

export async function resolveAutoSendScope(context: AutoSendScopeContext) {
  const scopes = await readAllScopes();
  const global = scopes.find((scope) => scope.scopeType === 'global');
  if (!global || global.actualSendEnabled || global.emergencyStop) {
    return {
      enabled: false as const,
      error: global?.emergencyStop ? 'emergency_stop' : 'global_guard_missing',
      scope: null,
      globalEmergencyStop: global?.emergencyStop === true,
    };
  }
  const scope = scopes
    .filter((item) => scopeRank(item, context) >= 0)
    .sort((left, right) => scopeRank(right, context) - scopeRank(left, context))[0] ?? null;
  if (!scope || !scope.actualSendEnabled || scope.emergencyStop) {
    return { enabled: false as const, error: 'scope_disabled', scope, globalEmergencyStop: false };
  }
  if (!scope.allowedChannels.includes(context.channel)) {
    return { enabled: false as const, error: 'channel_not_allowed', scope, globalEmergencyStop: false };
  }
  if (!scope.allowedMessageTypes.includes(context.messageType)) {
    return { enabled: false as const, error: 'message_type_not_allowed', scope, globalEmergencyStop: false };
  }
  return { enabled: true as const, scope, globalEmergencyStop: false };
}

export async function getAutoSendOperationalStatus() {
  const scopes = await readAllScopes();
  const { data: latestRun } = await supabase
    .from('booking_ops_communication_auto_send_runs')
    .select('id,source,dry_run,status,processed_count,sent_count,failed_count,blocked_count,started_at,finished_at,safe_summary')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: deliveries } = await supabase
    .from('booking_ops_communication_deliveries')
    .select('status')
    .limit(1000);
  const counts = { queued: 0, sent: 0, failed: 0 };
  for (const row of (deliveries ?? []) as Array<{ status?: string }>) {
    if (row.status === 'queued') counts.queued += 1;
    if (row.status === 'sent') counts.sent += 1;
    if (row.status === 'failed') counts.failed += 1;
  }
  const global = scopes.find((scope) => scope.scopeType === 'global') ?? null;
  return {
    globalActualSendEnabled: false,
    emergencyStop: global?.emergencyStop ?? true,
    scopes: scopes.filter((scope) => scope.scopeType !== 'global'),
    lastRun: latestRun ?? null,
    counts,
  };
}

export async function startAutoSendRun(input: { source: 'scheduled' | 'operator'; dryRun: boolean }) {
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(), source: input.source, dry_run: input.dryRun, status: 'running',
    processed_count: 0, sent_count: 0, failed_count: 0, blocked_count: 0,
    started_at: now, safe_summary: 'Запуск безопасной обработки.',
  };
  const { data, error } = await supabase
    .from('booking_ops_communication_auto_send_runs')
    .insert(row)
    .select('id')
    .maybeSingle();
  return error || !data ? null : String((data as { id: string }).id);
}

export async function finishAutoSendRun(runId: string | null, summary: {
  status: 'completed' | 'failed'; processed: number; sent: number; failed: number; blocked: number; safeSummary: string;
}) {
  if (!runId) return;
  await supabase.from('booking_ops_communication_auto_send_runs').update({
    status: summary.status,
    processed_count: summary.processed,
    sent_count: summary.sent,
    failed_count: summary.failed,
    blocked_count: summary.blocked,
    finished_at: new Date().toISOString(),
    safe_summary: summary.safeSummary.slice(0, 500),
  }).eq('id', runId);
}
