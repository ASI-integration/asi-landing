import {
  getOrCreateAutonomousSession,
  loadAutonomousSession,
  patchAutonomousSessionCollectedData,
} from './conversation-session-store';
import type { CommunicationChannel } from './types';
import type { OwnerOnboardingState, OwnerOnboardingStatus } from './telegram-owner-onboarding';
import { missingWizardFields } from './telegram-owner-onboarding-wizard';

function resolveMissingFields(state: Partial<OwnerOnboardingState>) {
  return missingWizardFields({
    city: state.city,
    address: state.address,
    object_type: state.object_type,
    object_name: state.property_name,
    owner_contact: state.owner_contact,
    checkin_time: state.checkin_time,
    checkout_time: state.checkout_time,
    channels: state.channels_list ?? (state.channels ? state.channels.split(',').map((item) => item.trim()) : []),
    rules: state.rules ?? (state.house_rules ? state.house_rules.split(',').map((item) => item.trim()) : []),
    wifi_name: state.wifi_name,
    wifi_password: state.wifi_password,
    wifi_skipped: state.wifi_skipped,
    photos: state.photos,
    photos_intent: state.photos_intent,
    photos_count: state.photos_count,
  });
}

export const OWNER_OBJECTS_REGISTRY_KEY = 'owner_objects_registry';
export const OWNER_OBJECT_STATE_PREFIX = 'owner_obj_state_';
export const LEGACY_SESSION_PREFIX = 'owner_onboarding_';

export type OwnerObjectRecord = {
  objectId: string;
  title: string;
  readinessPercent: number;
  status: OwnerOnboardingStatus;
  isActiveSession: boolean;
  updatedAt: string;
};

export type OwnerObjectsRegistry = {
  version: 1;
  activeObjectId: string;
  nextSeq: number;
  objects: OwnerObjectRecord[];
};

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function parseJsonArray(raw: unknown): string[] {
  const value = text(raw, 2000);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 120)).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function objectStateKey(objectId: string): string {
  return `${OWNER_OBJECT_STATE_PREFIX}${objectId}`;
}

function formatObjectId(seq: number): string {
  return `OBJ-${String(seq).padStart(4, '0')}`;
}

function parseRegistry(raw: unknown): OwnerObjectsRegistry | null {
  const value = text(raw, 8000);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as OwnerObjectsRegistry;
    if (parsed?.version !== 1 || !Array.isArray(parsed.objects) || !parsed.activeObjectId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function legacySessionValue(collected: Record<string, string | undefined>, field: string): string | undefined {
  return text(collected[`${LEGACY_SESSION_PREFIX}${field}`]).trim() || undefined;
}

function readLegacyState(collected: Record<string, string | undefined>): OwnerOnboardingState | null {
  const status = text(collected[`${LEGACY_SESSION_PREFIX}status`]);
  if (!status) return null;

  const photosIntentRaw = text(collected[`${LEGACY_SESSION_PREFIX}photos_intent`]);
  const awaitingCustomRaw = text(collected[`${LEGACY_SESSION_PREFIX}awaiting_custom`]);

  const state: OwnerOnboardingState = {
    address: legacySessionValue(collected, 'address'),
    property_name: legacySessionValue(collected, 'property_name'),
    house_rules: legacySessionValue(collected, 'house_rules'),
    wifi: legacySessionValue(collected, 'wifi'),
    checkin_checkout: legacySessionValue(collected, 'checkin_checkout'),
    photos: legacySessionValue(collected, 'photos'),
    channels: legacySessionValue(collected, 'channels'),
    city: text(collected[`${LEGACY_SESSION_PREFIX}city`]) || undefined,
    photos_intent: photosIntentRaw === 'later' || photosIntentRaw === 'now' ? photosIntentRaw : undefined,
    clarification_attempts: Number(collected[`${LEGACY_SESSION_PREFIX}clarification_attempts`] ?? 0) || 0,
    status: (status || 'onboarding_started') as OwnerOnboardingStatus,
    missing: [],
    lastMessage: text(collected[`${LEGACY_SESSION_PREFIX}last_message`], 600),
    lastClarificationQuestion: text(collected[`${LEGACY_SESSION_PREFIX}last_clarification`]) || undefined,
    channelManagerHref: text(collected[`${LEGACY_SESSION_PREFIX}channel_manager_href`]) || '/dashboard/channel-connections?source=telegram_onboarding',
    wizard_mode: text(collected[`${LEGACY_SESSION_PREFIX}wizard_mode`]) === 'legacy' ? 'legacy' : 'v2',
    object_type: text(collected[`${LEGACY_SESSION_PREFIX}object_type`]) || undefined,
    checkin_time: text(collected[`${LEGACY_SESSION_PREFIX}checkin_time`]) || undefined,
    checkout_time: text(collected[`${LEGACY_SESSION_PREFIX}checkout_time`]) || undefined,
    rules: parseJsonArray(collected[`${LEGACY_SESSION_PREFIX}rules`]),
    channels_list: parseJsonArray(collected[`${LEGACY_SESSION_PREFIX}channels_list`]),
    wifi_name: text(collected[`${LEGACY_SESSION_PREFIX}wifi_name`]) || undefined,
    wifi_password: text(collected[`${LEGACY_SESSION_PREFIX}wifi_password`]) || undefined,
    wifi_skipped: text(collected[`${LEGACY_SESSION_PREFIX}wifi_skipped`]) === '1',
    photos_count: Number(collected[`${LEGACY_SESSION_PREFIX}photos_count`] ?? 0) || 0,
    awaiting_custom:
      awaitingCustomRaw === 'checkin_time' || awaitingCustomRaw === 'checkout_time' || awaitingCustomRaw === 'channels'
        ? awaitingCustomRaw
        : undefined,
    channels_draft: parseJsonArray(collected[`${LEGACY_SESSION_PREFIX}channels_draft`]),
    rules_draft: parseJsonArray(collected[`${LEGACY_SESSION_PREFIX}rules_draft`]),
  };
  state.missing = resolveMissingFields(state);
  return state;
}

export function objectTitleFromState(state: Pick<OwnerOnboardingState, 'address' | 'city' | 'object_type' | 'property_name'>): string {
  if (state.property_name?.trim()) return state.property_name.trim();
  if (state.address?.trim()) return state.address.trim();
  if (state.city?.trim()) return `Объект в ${state.city.trim()}`;
  const type = state.object_type ?? state.property_name;
  if (type?.trim()) return type.trim();
  return 'Новый объект';
}

export function serializeOwnerObjectState(state: OwnerOnboardingState): string {
  return JSON.stringify({
    address: state.address,
    property_name: state.property_name,
    house_rules: state.house_rules,
    wifi: state.wifi,
    checkin_checkout: state.checkin_checkout,
    photos: state.photos,
    channels: state.channels,
    city: state.city,
    photos_intent: state.photos_intent,
    clarification_attempts: state.clarification_attempts,
    status: state.status,
    lastMessage: state.lastMessage,
    lastClarificationQuestion: state.lastClarificationQuestion,
    channelManagerHref: state.channelManagerHref,
    wizard_mode: state.wizard_mode,
    object_type: state.object_type,
    checkin_time: state.checkin_time,
    checkout_time: state.checkout_time,
    rules: state.rules,
    channels_list: state.channels_list,
    wifi_name: state.wifi_name,
    wifi_password: state.wifi_password,
    wifi_skipped: state.wifi_skipped,
    photos_count: state.photos_count,
    awaiting_custom: state.awaiting_custom,
    channels_draft: state.channels_draft,
    rules_draft: state.rules_draft,
    owner_contact: state.owner_contact,
    readiness_percent: state.readiness?.readiness_percent ?? null,
    mk_phase: state.mk_phase ?? null,
    mk_route: state.mk_route ?? null,
    selected_channel_manager: state.selected_channel_manager ?? null,
    property_in_channel_manager: state.property_in_channel_manager ?? null,
    mk_collection_mode: state.mk_collection_mode ?? null,
    target_placement_channels: state.target_placement_channels ?? null,
    target_placement_skipped: state.target_placement_skipped ?? false,
  });
}

export function deserializeOwnerObjectState(raw: unknown): OwnerOnboardingState | null {
  const value = text(raw, 12000);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OwnerOnboardingState> & { readiness_percent?: number | null };
    const state: OwnerOnboardingState = {
      address: parsed.address,
      property_name: parsed.property_name,
      house_rules: parsed.house_rules,
      wifi: parsed.wifi,
      checkin_checkout: parsed.checkin_checkout,
      photos: parsed.photos,
      channels: parsed.channels,
      city: parsed.city,
      photos_intent: parsed.photos_intent,
      clarification_attempts: Number(parsed.clarification_attempts ?? 0) || 0,
      status: (parsed.status ?? 'onboarding_started') as OwnerOnboardingStatus,
      missing: [],
      lastMessage: text(parsed.lastMessage, 600),
      lastClarificationQuestion: parsed.lastClarificationQuestion,
      channelManagerHref: parsed.channelManagerHref ?? '/dashboard/channel-connections?source=telegram_onboarding',
      wizard_mode: parsed.wizard_mode === 'legacy' ? 'legacy' : 'v2',
      object_type: parsed.object_type,
      checkin_time: parsed.checkin_time,
      checkout_time: parsed.checkout_time,
      rules: Array.isArray(parsed.rules) ? parsed.rules.map((item) => text(item, 120)).filter(Boolean) : [],
      channels_list: Array.isArray(parsed.channels_list)
        ? parsed.channels_list.map((item) => text(item, 120)).filter(Boolean)
        : [],
      wifi_name: parsed.wifi_name,
      wifi_password: parsed.wifi_password,
      wifi_skipped: Boolean(parsed.wifi_skipped),
      photos_count: Number(parsed.photos_count ?? 0) || 0,
      awaiting_custom: parsed.awaiting_custom,
      channels_draft: Array.isArray(parsed.channels_draft)
        ? parsed.channels_draft.map((item) => text(item, 120)).filter(Boolean)
        : [],
      rules_draft: Array.isArray(parsed.rules_draft)
        ? parsed.rules_draft.map((item) => text(item, 120)).filter(Boolean)
        : [],
      owner_contact: parsed.owner_contact,
      mk_phase: parsed.mk_phase,
      mk_route: parsed.mk_route,
      selected_channel_manager: parsed.selected_channel_manager,
      property_in_channel_manager: parsed.property_in_channel_manager,
      mk_collection_mode: parsed.mk_collection_mode,
      target_placement_channels: Array.isArray(parsed.target_placement_channels)
        ? parsed.target_placement_channels.map((item) => text(item, 120)).filter(Boolean)
        : undefined,
      target_placement_skipped: Boolean(parsed.target_placement_skipped),
    };
    state.missing = resolveMissingFields(state);
    return state;
  } catch {
    return null;
  }
}

function defaultOwnerObjectState(): OwnerOnboardingState {
  return {
    address: undefined,
    property_name: undefined,
    house_rules: undefined,
    wifi: undefined,
    checkin_checkout: undefined,
    photos: undefined,
    channels: undefined,
    clarification_attempts: 0,
    status: 'onboarding_started',
    missing: resolveMissingFields({ wizard_mode: 'v2' }),
    lastMessage: '',
    channelManagerHref: '/dashboard/channel-connections?source=telegram_onboarding',
    wizard_mode: 'v2',
    photos_count: 0,
    channels_draft: [],
    rules_draft: [],
    rules: [],
    channels_list: [],
  };
}

function recordFromState(objectId: string, state: OwnerOnboardingState, isActiveSession: boolean): OwnerObjectRecord {
  const now = new Date().toISOString();
  return {
    objectId,
    title: objectTitleFromState(state),
    readinessPercent: state.readiness?.readiness_percent ?? Number(state.missing.length === 0 ? 100 : 0),
    status: state.status,
    isActiveSession,
    updatedAt: now,
  };
}

function persistRegistry(chatId: number, channel: CommunicationChannel, registry: OwnerObjectsRegistry): void {
  patchAutonomousSessionCollectedData({
    chatId,
    channel,
    set: {
      [OWNER_OBJECTS_REGISTRY_KEY]: JSON.stringify(registry),
    },
  });
}

export function mirrorActiveObjectToLegacyKeys(
  chatId: number,
  channel: CommunicationChannel,
  objectId: string,
  state: OwnerOnboardingState,
): void {
  patchAutonomousSessionCollectedData({
    chatId,
    channel,
    set: {
      owner_active_object_id: objectId,
      [`${LEGACY_SESSION_PREFIX}address`]: state.address,
      [`${LEGACY_SESSION_PREFIX}property_name`]: state.property_name,
      [`${LEGACY_SESSION_PREFIX}house_rules`]: state.house_rules,
      [`${LEGACY_SESSION_PREFIX}wifi`]: state.wifi,
      [`${LEGACY_SESSION_PREFIX}checkin_checkout`]: state.checkin_checkout,
      [`${LEGACY_SESSION_PREFIX}photos`]: state.photos,
      [`${LEGACY_SESSION_PREFIX}channels`]: state.channels,
      [`${LEGACY_SESSION_PREFIX}city`]: state.city,
      [`${LEGACY_SESSION_PREFIX}photos_intent`]: state.photos_intent,
      [`${LEGACY_SESSION_PREFIX}clarification_attempts`]: String(state.clarification_attempts),
      [`${LEGACY_SESSION_PREFIX}status`]: state.status,
      [`${LEGACY_SESSION_PREFIX}missing`]: state.missing.join(','),
      [`${LEGACY_SESSION_PREFIX}last_message`]: state.lastMessage,
      [`${LEGACY_SESSION_PREFIX}last_clarification`]: state.lastClarificationQuestion,
      [`${LEGACY_SESSION_PREFIX}channel_manager_href`]: state.channelManagerHref,
      [`${LEGACY_SESSION_PREFIX}readiness_percent`]: String(state.readiness?.readiness_percent ?? ''),
      [`${LEGACY_SESSION_PREFIX}wizard_mode`]: state.wizard_mode ?? 'v2',
      [`${LEGACY_SESSION_PREFIX}object_type`]: state.object_type,
      [`${LEGACY_SESSION_PREFIX}checkin_time`]: state.checkin_time,
      [`${LEGACY_SESSION_PREFIX}checkout_time`]: state.checkout_time,
      [`${LEGACY_SESSION_PREFIX}rules`]: JSON.stringify(state.rules ?? []),
      [`${LEGACY_SESSION_PREFIX}channels_list`]: JSON.stringify(state.channels_list ?? []),
      [`${LEGACY_SESSION_PREFIX}wifi_name`]: state.wifi_name,
      [`${LEGACY_SESSION_PREFIX}wifi_password`]: state.wifi_password,
      [`${LEGACY_SESSION_PREFIX}wifi_skipped`]: state.wifi_skipped ? '1' : '0',
      [`${LEGACY_SESSION_PREFIX}photos_count`]: String(state.photos_count ?? 0),
      [`${LEGACY_SESSION_PREFIX}awaiting_custom`]: state.awaiting_custom,
      [`${LEGACY_SESSION_PREFIX}channels_draft`]: JSON.stringify(state.channels_draft ?? []),
      [`${LEGACY_SESSION_PREFIX}rules_draft`]: JSON.stringify(state.rules_draft ?? []),
      [`${LEGACY_SESSION_PREFIX}owner_contact`]: state.owner_contact,
      [objectStateKey(objectId)]: serializeOwnerObjectState(state),
    },
  });
}

export function loadOwnerObjectsRegistry(chatId: number): OwnerObjectsRegistry | null {
  const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
  return parseRegistry(collected[OWNER_OBJECTS_REGISTRY_KEY]);
}

export function migrateLegacyOwnerSessionIfNeeded(chatId: number, channel: CommunicationChannel): OwnerObjectsRegistry | null {
  const existing = loadOwnerObjectsRegistry(chatId);
  if (existing) return existing;

  const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
  const legacy = readLegacyState(collected);
  if (!legacy) return null;

  const objectId = 'OBJ-0001';
  const now = new Date().toISOString();
  const registry: OwnerObjectsRegistry = {
    version: 1,
    activeObjectId: objectId,
    nextSeq: 2,
    objects: [
      {
        objectId,
        title: objectTitleFromState(legacy),
        readinessPercent: legacy.readiness?.readiness_percent ?? 0,
        status: legacy.status,
        isActiveSession: true,
        updatedAt: now,
      },
    ],
  };

  patchAutonomousSessionCollectedData({
    chatId,
    channel,
    set: {
      [OWNER_OBJECTS_REGISTRY_KEY]: JSON.stringify(registry),
      [objectStateKey(objectId)]: serializeOwnerObjectState(legacy),
      owner_active_object_id: objectId,
    },
  });
  mirrorActiveObjectToLegacyKeys(chatId, channel, objectId, legacy);
  return registry;
}

export function ensureOwnerObjectsRegistry(chatId: number, channel: CommunicationChannel): OwnerObjectsRegistry {
  getOrCreateAutonomousSession(chatId, channel);
  const migrated = migrateLegacyOwnerSessionIfNeeded(chatId, channel);
  if (migrated) return migrated;

  const existing = loadOwnerObjectsRegistry(chatId);
  if (existing) return existing;

  const objectId = 'OBJ-0001';
  const state = defaultOwnerObjectState();
  const now = new Date().toISOString();
  const registry: OwnerObjectsRegistry = {
    version: 1,
    activeObjectId: objectId,
    nextSeq: 2,
    objects: [
      {
        objectId,
        title: objectTitleFromState(state),
        readinessPercent: 0,
        status: state.status,
        isActiveSession: true,
        updatedAt: now,
      },
    ],
  };

  patchAutonomousSessionCollectedData({
    chatId,
    channel,
    set: {
      [OWNER_OBJECTS_REGISTRY_KEY]: JSON.stringify(registry),
      [objectStateKey(objectId)]: serializeOwnerObjectState(state),
      owner_active_object_id: objectId,
    },
  });
  mirrorActiveObjectToLegacyKeys(chatId, channel, objectId, state);
  return registry;
}

export function getActiveOwnerObjectId(chatId: number, channel: CommunicationChannel): string {
  const registry = ensureOwnerObjectsRegistry(chatId, channel);
  return registry.activeObjectId;
}

export function readOwnerObjectStateIfExists(
  chatId: number,
  channel: CommunicationChannel,
  objectId?: string,
): OwnerOnboardingState | null {
  const registry = migrateLegacyOwnerSessionIfNeeded(chatId, channel) ?? loadOwnerObjectsRegistry(chatId);
  if (!registry) {
    const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
    const legacy = readLegacyState(collected);
    return legacy;
  }

  const resolvedId = objectId ?? registry.activeObjectId;
  const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
  const stored = deserializeOwnerObjectState(collected[objectStateKey(resolvedId)]);
  if (stored) return stored;
  if (resolvedId === registry.activeObjectId) {
    const legacy = readLegacyState(collected);
    if (legacy) return legacy;
  }
  return null;
}

export function readOwnerObjectState(chatId: number, channel: CommunicationChannel, objectId?: string): OwnerOnboardingState {
  const registry = ensureOwnerObjectsRegistry(chatId, channel);
  const resolvedId = objectId ?? registry.activeObjectId;
  const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
  const stored = deserializeOwnerObjectState(collected[objectStateKey(resolvedId)]);
  if (stored) return stored;

  if (resolvedId === registry.activeObjectId) {
    const legacy = readLegacyState(collected);
    if (legacy) return legacy;
  }

  return defaultOwnerObjectState();
}

export function listOwnerObjectRecords(chatId: number, channel: CommunicationChannel): OwnerObjectRecord[] {
  const registry = ensureOwnerObjectsRegistry(chatId, channel);
  return registry.objects.map((item) => ({
    ...item,
    isActiveSession: item.objectId === registry.activeObjectId,
  }));
}

export function ownerHasExistingObjects(chatId: number, channel: CommunicationChannel): boolean {
  const registry = migrateLegacyOwnerSessionIfNeeded(chatId, channel) ?? loadOwnerObjectsRegistry(chatId);
  return Boolean(registry && registry.objects.length > 0);
}

export function createOwnerObject(chatId: number, channel: CommunicationChannel): { objectId: string; state: OwnerOnboardingState } {
  const registry = ensureOwnerObjectsRegistry(chatId, channel);
  const objectId = formatObjectId(registry.nextSeq);
  const state = defaultOwnerObjectState();
  const now = new Date().toISOString();

  const nextRegistry: OwnerObjectsRegistry = {
    version: 1,
    activeObjectId: objectId,
    nextSeq: registry.nextSeq + 1,
    objects: [
      ...registry.objects.map((item) => ({ ...item, isActiveSession: false })),
      {
        objectId,
        title: objectTitleFromState(state),
        readinessPercent: 0,
        status: state.status,
        isActiveSession: true,
        updatedAt: now,
      },
    ],
  };

  persistRegistry(chatId, channel, nextRegistry);
  mirrorActiveObjectToLegacyKeys(chatId, channel, objectId, state);
  return { objectId, state };
}

export function switchActiveOwnerObject(
  chatId: number,
  channel: CommunicationChannel,
  objectId: string,
): OwnerOnboardingState | null {
  const registry = ensureOwnerObjectsRegistry(chatId, channel);
  if (!registry.objects.some((item) => item.objectId === objectId)) return null;

  const state = readOwnerObjectState(chatId, channel, objectId);
  const nextRegistry: OwnerObjectsRegistry = {
    ...registry,
    activeObjectId: objectId,
    objects: registry.objects.map((item) => ({
      ...item,
      isActiveSession: item.objectId === objectId,
      title: item.objectId === objectId ? objectTitleFromState(state) : item.title,
      readinessPercent: item.objectId === objectId ? (state.readiness?.readiness_percent ?? item.readinessPercent) : item.readinessPercent,
      status: item.objectId === objectId ? state.status : item.status,
      updatedAt: item.objectId === objectId ? new Date().toISOString() : item.updatedAt,
    })),
  };

  persistRegistry(chatId, channel, nextRegistry);
  mirrorActiveObjectToLegacyKeys(chatId, channel, objectId, state);
  return state;
}

export function persistOwnerObjectState(
  chatId: number,
  channel: CommunicationChannel,
  objectId: string,
  state: OwnerOnboardingState,
): OwnerObjectsRegistry {
  const registry = ensureOwnerObjectsRegistry(chatId, channel);
  const record = recordFromState(objectId, state, objectId === registry.activeObjectId);
  const nextRegistry: OwnerObjectsRegistry = {
    ...registry,
    activeObjectId: registry.activeObjectId,
    objects: registry.objects.some((item) => item.objectId === objectId)
      ? registry.objects.map((item) => (item.objectId === objectId ? record : { ...item, isActiveSession: item.objectId === registry.activeObjectId }))
      : [...registry.objects, record],
  };

  persistRegistry(chatId, channel, nextRegistry);
  if (objectId === nextRegistry.activeObjectId) {
    mirrorActiveObjectToLegacyKeys(chatId, channel, objectId, state);
  } else {
    patchAutonomousSessionCollectedData({
      chatId,
      channel,
      set: {
        [objectStateKey(objectId)]: serializeOwnerObjectState(state),
      },
    });
  }
  return nextRegistry;
}
