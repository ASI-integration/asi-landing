import { supabase } from '@/lib/supabase';
import { upsertCrmContactFromTelegram } from '@/lib/crm/repository';
import type { CrmRole } from '@/lib/crm/types';
import {
  clearTelegramRoutingSession,
  patchTelegramRoutingSession,
  setTelegramRoutingSession,
  type TelegramCommunicationMode,
  type TelegramRoutingRole,
  type TelegramRoutingSession,
} from '@/lib/communication/telegram-routing-session';

export type TelegramMemoryRole =
  | 'guest'
  | 'owner'
  | 'lead'
  | 'support'
  | 'tester'
  | 'operator'
  | 'unknown';

export type TelegramActiveScenario =
  | 'owner_onboarding'
  | 'guest_test'
  | 'support'
  | 'emergency'
  | null;

export type TelegramConversationMemory = {
  telegramUserId: string;
  chatId: number;
  telegramUsername: string | null;
  displayName: string | null;
  crmContactId: string | null;
  role: TelegramMemoryRole;
  activeScenario: TelegramActiveScenario;
  propertyId: string | null;
  guestTestActive: boolean;
  communicationMode: TelegramCommunicationMode;
  leadSource: string | null;
  metadata: Record<string, unknown>;
  lastSeenAt: string;
  updatedAt: string;
};

type MemoryRow = {
  telegram_user_id: string;
  chat_id: number;
  telegram_username: string | null;
  display_name: string | null;
  crm_contact_id: string | null;
  role: string;
  active_scenario: string | null;
  property_id: string | null;
  guest_test_active: boolean;
  communication_mode: string;
  lead_source: string | null;
  metadata: Record<string, unknown> | null;
  last_seen_at: string;
  updated_at: string;
};

const MEMORY_SELECT =
  'telegram_user_id, chat_id, telegram_username, display_name, crm_contact_id, role, active_scenario, property_id, guest_test_active, communication_mode, lead_source, metadata, last_seen_at, updated_at';

const testCache = new Map<string, TelegramConversationMemory>();

function nowIso(): string {
  return new Date().toISOString();
}

function isDryRun(): boolean {
  return process.env.TELEGRAM_DRY_RUN === '1';
}

function parseMemoryRole(value: string | null | undefined): TelegramMemoryRole {
  const role = String(value ?? '').trim();
  if (
    role === 'guest' ||
    role === 'owner' ||
    role === 'lead' ||
    role === 'support' ||
    role === 'tester' ||
    role === 'operator'
  ) {
    return role;
  }
  return 'unknown';
}

function parseActiveScenario(value: string | null | undefined): TelegramActiveScenario {
  const scenario = String(value ?? '').trim();
  if (
    scenario === 'owner_onboarding' ||
    scenario === 'guest_test' ||
    scenario === 'support' ||
    scenario === 'emergency'
  ) {
    return scenario;
  }
  return null;
}

function parseCommunicationMode(value: string | null | undefined): TelegramCommunicationMode {
  const mode = String(value ?? '').trim().toLowerCase();
  if (mode === 'manual' || mode === 'draft' || mode === 'autopilot') return mode;
  return 'autopilot';
}

function rowToMemory(row: MemoryRow): TelegramConversationMemory {
  return {
    telegramUserId: row.telegram_user_id,
    chatId: Number(row.chat_id),
    telegramUsername: row.telegram_username,
    displayName: row.display_name,
    crmContactId: row.crm_contact_id,
    role: parseMemoryRole(row.role),
    activeScenario: parseActiveScenario(row.active_scenario),
    propertyId: row.property_id,
    guestTestActive: Boolean(row.guest_test_active),
    communicationMode: parseCommunicationMode(row.communication_mode),
    leadSource: row.lead_source,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
  };
}

function memoryRoleToCrmRole(role: TelegramMemoryRole): CrmRole {
  if (role === 'owner' || role === 'operator') return 'owner';
  if (role === 'lead') return 'lead';
  if (role === 'guest' || role === 'tester') return 'guest';
  return 'unknown';
}

function memoryRoleToRoutingRole(role: TelegramMemoryRole): TelegramRoutingRole {
  if (role === 'owner' || role === 'operator') return 'owner';
  if (role === 'lead') return 'lead';
  if (role === 'guest' || role === 'tester') return 'guest';
  if (role === 'support') return 'support';
  return 'unknown';
}

export function __resetTelegramIdentityMemoryForTests(): void {
  testCache.clear();
}

export function memoryToRoutingSession(memory: TelegramConversationMemory): TelegramRoutingSession {
  const routingRole = memoryRoleToRoutingRole(memory.role);
  return {
    role: routingRole,
    selectedRole: routingRole === 'unknown' ? undefined : routingRole,
    communicationMode: memory.communicationMode,
    leadSource: memory.leadSource ?? undefined,
    testGuest: memory.guestTestActive,
    testPropertyId: memory.propertyId,
    updatedAt: memory.updatedAt,
  };
}

export function applyMemoryToRoutingSession(chatId: number, memory: TelegramConversationMemory): TelegramRoutingSession {
  const session = memoryToRoutingSession(memory);
  setTelegramRoutingSession(chatId, session);
  return session;
}

export async function loadTelegramConversationMemory(
  telegramUserId: string,
): Promise<TelegramConversationMemory | null> {
  const userId = telegramUserId.trim();
  if (!userId) return null;

  const cached = testCache.get(userId);
  if (cached) return cached;

  if (isDryRun()) return null;

  try {
    const { data, error } = await supabase
      .from('tg_telegram_conversation_memory')
      .select(MEMORY_SELECT)
      .eq('telegram_user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const memory = rowToMemory(data as MemoryRow);
    testCache.set(userId, memory);
    return memory;
  } catch {
    return null;
  }
}

export async function loadTelegramConversationMemoryByChatId(
  chatId: number,
): Promise<TelegramConversationMemory | null> {
  for (const memory of testCache.values()) {
    if (memory.chatId === chatId) return memory;
  }
  if (isDryRun()) return null;

  try {
    const { data, error } = await supabase
      .from('tg_telegram_conversation_memory')
      .select(MEMORY_SELECT)
      .eq('chat_id', chatId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const memory = rowToMemory(data as MemoryRow);
    testCache.set(memory.telegramUserId, memory);
    return memory;
  } catch {
    return null;
  }
}

export async function ensureTelegramIdentityWithCrm(input: {
  telegramUserId: string;
  chatId: number;
  telegramUsername?: string | null;
  displayName?: string | null;
  role?: TelegramMemoryRole;
  source?: 'telegram' | 'test';
  propertyId?: string | null;
  status?: string;
  allowCreate?: boolean;
}): Promise<TelegramConversationMemory> {
  const telegramUserId = input.telegramUserId.trim();
  const now = nowIso();
  const existing = await loadTelegramConversationMemory(telegramUserId);
  const role = input.role ?? existing?.role ?? 'unknown';

  let crmContactId = existing?.crmContactId ?? null;
  if (input.allowCreate !== false) {
    try {
      const contact = await upsertCrmContactFromTelegram({
        name: input.displayName,
        role: memoryRoleToCrmRole(role),
        source: input.source ?? (role === 'tester' ? 'test' : 'telegram'),
        telegramUserId,
        telegramUsername: input.telegramUsername,
        telegramChatId: input.chatId,
        propertyId: input.propertyId ?? existing?.propertyId ?? undefined,
        status: input.status as never,
        allowCreate: true,
      });
      crmContactId = contact?.id ?? crmContactId;
    } catch (error) {
      console.error('[telegram-identity] CRM upsert failed', {
        error: error instanceof Error ? error.message : String(error),
        telegram_user_id: telegramUserId,
      });
    }
  }

  return upsertTelegramConversationMemory({
    telegramUserId,
    chatId: input.chatId,
    telegramUsername: input.telegramUsername ?? existing?.telegramUsername ?? null,
    displayName: input.displayName ?? existing?.displayName ?? null,
    crmContactId,
    role,
    activeScenario: existing?.activeScenario ?? null,
    propertyId: input.propertyId ?? existing?.propertyId ?? null,
    guestTestActive: existing?.guestTestActive ?? false,
    communicationMode: existing?.communicationMode ?? 'autopilot',
    leadSource: existing?.leadSource ?? null,
    metadata: existing?.metadata ?? {},
    lastSeenAt: now,
  });
}

export async function upsertTelegramConversationMemory(input: {
  telegramUserId: string;
  chatId: number;
  telegramUsername?: string | null;
  displayName?: string | null;
  crmContactId?: string | null;
  role?: TelegramMemoryRole;
  activeScenario?: TelegramActiveScenario;
  propertyId?: string | null;
  guestTestActive?: boolean;
  communicationMode?: TelegramCommunicationMode;
  leadSource?: string | null;
  metadata?: Record<string, unknown>;
  lastSeenAt?: string;
}): Promise<TelegramConversationMemory> {
  const telegramUserId = input.telegramUserId.trim();
  const existing = await loadTelegramConversationMemory(telegramUserId);
  const now = input.lastSeenAt ?? nowIso();

  const memory: TelegramConversationMemory = {
    telegramUserId,
    chatId: input.chatId,
    telegramUsername: input.telegramUsername ?? existing?.telegramUsername ?? null,
    displayName: input.displayName ?? existing?.displayName ?? null,
    crmContactId: input.crmContactId ?? existing?.crmContactId ?? null,
    role: input.role ?? existing?.role ?? 'unknown',
    activeScenario: input.activeScenario !== undefined ? input.activeScenario : (existing?.activeScenario ?? null),
    propertyId: input.propertyId !== undefined ? input.propertyId : (existing?.propertyId ?? null),
    guestTestActive: input.guestTestActive ?? existing?.guestTestActive ?? false,
    communicationMode: input.communicationMode ?? existing?.communicationMode ?? 'autopilot',
    leadSource: input.leadSource !== undefined ? input.leadSource : (existing?.leadSource ?? null),
    metadata: input.metadata ?? existing?.metadata ?? {},
    lastSeenAt: now,
    updatedAt: now,
  };

  testCache.set(telegramUserId, memory);

  if (!isDryRun()) {
    try {
      await supabase.from('tg_telegram_conversation_memory').upsert({
        telegram_user_id: memory.telegramUserId,
        chat_id: memory.chatId,
        telegram_username: memory.telegramUsername,
        display_name: memory.displayName,
        crm_contact_id: memory.crmContactId,
        role: memory.role,
        active_scenario: memory.activeScenario,
        property_id: memory.propertyId,
        guest_test_active: memory.guestTestActive,
        communication_mode: memory.communicationMode,
        lead_source: memory.leadSource,
        metadata: memory.metadata,
        last_seen_at: memory.lastSeenAt,
        updated_at: memory.updatedAt,
      });
    } catch (error) {
      console.error('[telegram-identity] persist failed', {
        error: error instanceof Error ? error.message : String(error),
        telegram_user_id: telegramUserId,
      });
    }
  }

  return memory;
}

export async function hydrateTelegramRoutingSessionFromMemory(input: {
  telegramUserId: string;
  chatId: number;
}): Promise<TelegramConversationMemory | null> {
  const memory =
    (await loadTelegramConversationMemory(input.telegramUserId)) ??
    (await loadTelegramConversationMemoryByChatId(input.chatId));
  if (!memory) return null;
  applyMemoryToRoutingSession(input.chatId, memory);
  return memory;
}

export async function patchTelegramIdentityMemory(input: {
  telegramUserId: string;
  chatId: number;
  telegramUsername?: string | null;
  displayName?: string | null;
  role?: TelegramMemoryRole;
  activeScenario?: TelegramActiveScenario;
  propertyId?: string | null;
  guestTestActive?: boolean;
  communicationMode?: TelegramCommunicationMode;
  leadSource?: string | null;
  crmContactId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<TelegramConversationMemory> {
  const memory = await upsertTelegramConversationMemory({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    telegramUsername: input.telegramUsername,
    displayName: input.displayName,
    crmContactId: input.crmContactId,
    role: input.role,
    activeScenario: input.activeScenario,
    propertyId: input.propertyId,
    guestTestActive: input.guestTestActive,
    communicationMode: input.communicationMode,
    leadSource: input.leadSource,
    metadata: input.metadata,
  });
  applyMemoryToRoutingSession(input.chatId, memory);
  patchTelegramRoutingSession(input.chatId, memoryToRoutingSession(memory));
  return memory;
}

export async function clearTelegramIdentityGuestTest(input: {
  telegramUserId: string;
  chatId: number;
}): Promise<void> {
  await resetTelegramIdentityMemory(input);
}

export async function resetTelegramIdentityMemory(input: {
  telegramUserId: string;
  chatId: number;
}): Promise<void> {
  testCache.delete(input.telegramUserId.trim());
  clearTelegramRoutingSession(input.chatId);

  if (isDryRun()) return;

  try {
    await supabase
      .from('tg_telegram_conversation_memory')
      .delete()
      .eq('telegram_user_id', input.telegramUserId.trim());
  } catch (error) {
    console.error('[telegram-identity] reset failed', {
      error: error instanceof Error ? error.message : String(error),
      telegram_user_id: input.telegramUserId,
    });
  }
}

export function routingRoleToMemoryRole(
  role: TelegramRoutingRole,
  testGuest?: boolean,
): TelegramMemoryRole {
  if (testGuest) return 'tester';
  if (role === 'owner') return 'owner';
  if (role === 'lead') return 'lead';
  if (role === 'guest') return 'guest';
  if (role === 'support') return 'support';
  return 'unknown';
}
