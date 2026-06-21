import { supabase } from '@/lib/supabase';
import {
  loadAutonomousSession,
  patchAutonomousSessionCollectedData,
} from './conversation-session-store';
import {
  detectsExplicitOperatorRequest,
  extractFactsDeterministic,
  extractOnboardingFactsSmart,
  isIdentitySelectionText,
  type OwnerOnboardingField,
  type PhotosIntent,
  type SmartParseDecision,
} from './owner-onboarding-smart-parser';
import type { InboundMessageEnvelope } from './types';
import type { SenderIdentity, TelegramInlineKeyboardMarkup } from './communication-identity-routing';

export type OwnerOnboardingStatus =
  | 'onboarding_started'
  | 'missing_required_data'
  | 'ready_for_channel_manager'
  | 'channel_manager_started'
  | 'needs_operator';

export type { OwnerOnboardingField };

export type OwnerOnboardingState = Record<OwnerOnboardingField, string | undefined> & {
  city?: string;
  photos_intent?: PhotosIntent;
  clarification_attempts: number;
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  lastMessage: string;
  channelManagerHref: string;
  lastClarificationQuestion?: string;
};

export type OwnerOnboardingResult = {
  handled: boolean;
  replyText: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  crmContactId?: string;
  state: OwnerOnboardingState;
};

const FIELD_LABELS: Record<OwnerOnboardingField, string> = {
  address: 'адрес объекта',
  property_name: 'название или тип объекта',
  house_rules: 'правила проживания',
  wifi: 'Wi-Fi',
  checkin_checkout: 'время заезда и выезда',
  photos: 'фото объекта',
  channels: 'каналы бронирования',
};

const FIELD_QUESTIONS: Record<OwnerOnboardingField, string> = {
  address: 'Пришлите адрес объекта одним сообщением: город, улица и номер дома.',
  property_name: 'Напишите название или тип объекта: квартира, апартаменты, дом или другой формат.',
  house_rules: 'Пришлите основные правила проживания: курение, животные, тишина, гости, залог.',
  wifi: 'Пришлите название сети и пароль Wi-Fi. Если Wi-Fi пока нет, так и напишите.',
  checkin_checkout: 'Напишите время заезда и выезда, например: заезд с 15:00, выезд до 11:00.',
  photos: 'Отправьте хотя бы одно фото объекта в этот чат или напишите, что добавите позже.',
  channels: 'Выберите или напишите каналы: Авито, Суточно, Островок, Яндекс Путешествия, Airbnb, Booking.com, свой сайт.',
};

const FIELD_ACK: Partial<Record<OwnerOnboardingField, string>> = {
  address: 'адрес',
  property_name: 'тип объекта',
  house_rules: 'правила проживания',
  wifi: 'Wi-Fi',
  checkin_checkout: 'время заезда и выезда',
  photos: 'фото',
  channels: 'каналы',
};

const CHANNEL_MANAGER_HREF = '/dashboard/channel-connections?source=telegram_onboarding';
const CHANNEL_MANAGER_URL = 'https://asi-global.ru/dashboard/channel-connections?source=telegram_onboarding';
const SESSION_PREFIX = 'owner_onboarding_';
const NOTE_HEADER = 'Онбординг ASI';

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function telegramUsername(envelope: InboundMessageEnvelope): string {
  return text(
    envelope.metadata?.telegram_username ??
      envelope.metadata?.telegramUsername ??
      (envelope.metadata as any)?.telegram?.username,
    80,
  ).replace(/^@+/, '');
}

function telegramContactKey(envelope: InboundMessageEnvelope): string {
  const username = telegramUsername(envelope);
  if (username) return username;
  const userId = text(envelope.metadata?.telegram_user_id ?? envelope.externalUserId ?? envelope.chatId, 80);
  return userId ? `tg:${userId}` : '';
}

function telegramDisplayName(envelope: InboundMessageEnvelope): string {
  const firstName = text(envelope.metadata?.telegram_first_name ?? (envelope.metadata as any)?.telegram?.first_name, 120);
  const username = telegramUsername(envelope);
  if (firstName) return firstName;
  if (username) return `@${username}`;
  return 'Telegram лид';
}

function sessionValue(collected: Record<string, string | undefined>, field: OwnerOnboardingField): string | undefined {
  return text(collected[`${SESSION_PREFIX}${field}`]).trim() || undefined;
}

function readStateFromSession(chatId: number): OwnerOnboardingState {
  const collected = loadAutonomousSession(chatId)?.collected_data ?? {};
  const photosIntentRaw = text(collected[`${SESSION_PREFIX}photos_intent`]);
  const photosIntent: PhotosIntent | undefined =
    photosIntentRaw === 'later' || photosIntentRaw === 'now' ? photosIntentRaw : undefined;

  const state: OwnerOnboardingState = {
    address: sessionValue(collected, 'address'),
    property_name: sessionValue(collected, 'property_name'),
    house_rules: sessionValue(collected, 'house_rules'),
    wifi: sessionValue(collected, 'wifi'),
    checkin_checkout: sessionValue(collected, 'checkin_checkout'),
    photos: sessionValue(collected, 'photos'),
    channels: sessionValue(collected, 'channels'),
    city: text(collected[`${SESSION_PREFIX}city`]) || undefined,
    photos_intent: photosIntent,
    clarification_attempts: Number(collected[`${SESSION_PREFIX}clarification_attempts`] ?? 0) || 0,
    status: (text(collected[`${SESSION_PREFIX}status`]) || 'onboarding_started') as OwnerOnboardingStatus,
    missing: [] as OwnerOnboardingField[],
    lastMessage: text(collected[`${SESSION_PREFIX}last_message`], 600),
    lastClarificationQuestion: text(collected[`${SESSION_PREFIX}last_clarification`]) || undefined,
    channelManagerHref: CHANNEL_MANAGER_HREF,
  };
  state.missing = missingFields(state);
  return state;
}

export function missingFields(state: Partial<OwnerOnboardingState>): OwnerOnboardingField[] {
  return (Object.keys(FIELD_LABELS) as OwnerOnboardingField[]).filter((field) => {
    if (field === 'photos' && (state.photos || state.photos_intent === 'later')) return false;
    return !text(state[field]);
  });
}

function detectsChannelManagerStarted(messageText: string): boolean {
  const n = text(messageText)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /начал|перешел|открыл|зашел|запустил/.test(n) && /менеджер каналов|канал/.test(n);
}

function countExtractedFields(
  facts: Partial<Record<OwnerOnboardingField, string>>,
  extras?: { photos_intent?: PhotosIntent; city?: string },
): number {
  let count = Object.keys(facts).length;
  if (extras?.photos_intent === 'later') count += 1;
  if (extras?.city && !facts.address) count += 1;
  return count;
}

function statusForState(params: {
  previousStatus: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  extractedCount: number;
  messageText: string;
  decision: SmartParseDecision;
  clarificationAttempts: number;
}): OwnerOnboardingStatus {
  if (params.previousStatus === 'needs_operator') return 'needs_operator';
  if (detectsChannelManagerStarted(params.messageText)) return 'channel_manager_started';
  if (params.missing.length === 0) return 'ready_for_channel_manager';

  if (params.decision.needs_operator || detectsExplicitOperatorRequest(params.messageText)) {
    return 'needs_operator';
  }

  if (isIdentitySelectionText(params.messageText)) {
    return params.extractedCount > 0 ? 'missing_required_data' : 'onboarding_started';
  }

  if (params.decision.needs_clarification || (params.extractedCount === 0 && params.previousStatus !== 'onboarding_started')) {
    if (params.clarificationAttempts >= 2) return 'needs_operator';
    if (params.extractedCount > 0) return 'missing_required_data';
    return params.previousStatus === 'onboarding_started' ? 'onboarding_started' : 'missing_required_data';
  }

  if (params.extractedCount === 0 && params.clarificationAttempts >= 2 && !isIdentitySelectionText(params.messageText)) {
    return 'needs_operator';
  }

  if (params.extractedCount > 0) return 'missing_required_data';
  return params.previousStatus === 'onboarding_started' ? 'onboarding_started' : 'missing_required_data';
}

function nextClarificationAttempts(params: {
  previousAttempts: number;
  extractedCount: number;
  messageText: string;
  decision: SmartParseDecision;
  previousStatus: OwnerOnboardingStatus;
}): number {
  if (params.extractedCount > 0) return 0;
  if (isIdentitySelectionText(params.messageText)) return params.previousAttempts;
  if (detectsExplicitOperatorRequest(params.messageText) || params.decision.needs_operator) {
    return params.previousAttempts;
  }
  return params.previousAttempts + 1;
}

function missingListRu(missing: OwnerOnboardingField[]): string {
  return missing.map((field) => FIELD_LABELS[field]).join(', ');
}

function savedAckRu(
  facts: Partial<Record<OwnerOnboardingField, string>>,
  extras?: { photos_intent?: PhotosIntent },
): string {
  const saved: string[] = [];
  for (const field of Object.keys(facts) as OwnerOnboardingField[]) {
    if (facts[field]) saved.push(FIELD_ACK[field] ?? FIELD_LABELS[field]);
  }
  if (extras?.photos_intent === 'later' && !facts.photos) saved.push('фото позже');
  return saved.join(', ');
}

function buildReply(params: {
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  facts: Partial<Record<OwnerOnboardingField, string>>;
  decision: SmartParseDecision;
  photosIntent?: PhotosIntent;
}): string {
  if (params.status === 'needs_operator') {
    return 'Похоже, здесь нужна ручная помощь. Я передала диалог оператору: он посмотрит данные объекта и ответит здесь.';
  }
  if (params.status === 'channel_manager_started') {
    return 'Отлично, отметила старт Менеджера каналов. Если на шаге подключения что-то остановит процесс, напишите сюда — подключу оператора.';
  }
  if (params.status === 'ready_for_channel_manager') {
    return [
      'Минимальные данные по объекту собраны. Объект готов к следующему шагу — Менеджеру каналов.',
      `Открыть: ${CHANNEL_MANAGER_URL}`,
      'Реальных вызовов к площадкам сейчас не делаю: это подготовка к подключению.',
    ].join('\n');
  }

  const next = params.missing[0] ?? 'address';
  const saved = savedAckRu(params.facts, { photos_intent: params.photosIntent });

  if (params.decision.clarification_question && params.decision.needs_clarification) {
    const intro = saved ? `Поняла, ${saved} сохранила.` : params.decision.clarification_question;
    if (saved && params.decision.clarification_question) {
      return [intro, params.decision.clarification_question].join('\n\n');
    }
    return intro;
  }

  if (!saved && params.status === 'onboarding_started' && next === 'address') {
    return 'Поняла. Помогу подключить объект к ASI.\n\nДля начала укажите адрес объекта: город, улица и номер дома.';
  }

  if (saved) {
    const missingHint = params.missing.length
      ? `Сейчас не хватает: ${missingListRu(params.missing)}.`
      : '';
    const question = FIELD_QUESTIONS[next];
    if (params.facts.address && next === 'property_name') {
      return [`Поняла, адрес сохранила.`, missingHint, `Теперь укажите, пожалуйста, что это за объект: квартира, апартаменты, дом или другой формат.`]
        .filter(Boolean)
        .join('\n');
    }
    if (params.photosIntent === 'later') {
      return [`Поняла, фото можно добавить позже.`, missingHint, question].filter(Boolean).join('\n');
    }
    return [`Поняла, ${saved} сохранила.`, missingHint, question].filter(Boolean).join('\n');
  }

  return [
    'Начнём подключение объекта к ASI. Я буду спрашивать только то, чего не хватает.',
    `Сейчас не хватает: ${missingListRu(params.missing)}.`,
    `Следующий шаг: ${FIELD_QUESTIONS[next]}`,
  ].join('\n');
}

function readyMarkup(status: OwnerOnboardingStatus): TelegramInlineKeyboardMarkup | undefined {
  if (status !== 'ready_for_channel_manager' && status !== 'channel_manager_started') return undefined;
  return {
    inline_keyboard: [[{ text: 'Открыть Менеджер каналов', url: CHANNEL_MANAGER_URL }]],
  };
}

function noteWithoutOnboardingBlock(note: string): string {
  const lines = text(note, 4000).split('\n');
  const start = lines.findIndex((line) => line.trim() === NOTE_HEADER);
  if (start === -1) return text(note, 4000);
  const before = lines.slice(0, start);
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== '') end += 1;
  const after = lines.slice(end + 1);
  return [...before, ...after].join('\n').trim();
}

function buildCrmNote(params: {
  existingNote?: string | null;
  state: OwnerOnboardingState;
}): string {
  const base = noteWithoutOnboardingBlock(params.existingNote ?? '');
  const block = [
    NOTE_HEADER,
    `Статус: ${params.state.status}`,
    params.state.city ? `Город: ${params.state.city}` : null,
    params.state.photos_intent === 'later' ? 'Фото: обещаны позже' : null,
    `Не хватает: ${params.state.missing.length ? missingListRu(params.state.missing) : 'ничего'}`,
    `Последнее сообщение: ${params.state.lastMessage || 'нет текста'}`,
    `Менеджер каналов: ${CHANNEL_MANAGER_HREF}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [base, block].filter(Boolean).join('\n\n').slice(0, 2000);
}

async function findCrmContact(envelope: InboundMessageEnvelope): Promise<{ id: string; notes?: string | null } | null> {
  const username = telegramUsername(envelope);
  const contactKey = telegramContactKey(envelope);
  try {
    if (username) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id,notes')
        .eq('telegram_username', username)
        .maybeSingle();
      if (!error && data) return data as { id: string; notes?: string | null };
    }
    if (contactKey) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id,notes')
        .eq('contact', contactKey)
        .maybeSingle();
      if (!error && data) return data as { id: string; notes?: string | null };
    }
  } catch {
    return null;
  }
  return null;
}

async function upsertCrmContact(params: {
  envelope: InboundMessageEnvelope;
  senderIdentity: SenderIdentity;
  state: OwnerOnboardingState;
}): Promise<string | undefined> {
  const contactKey = telegramContactKey(params.envelope);
  if (!contactKey) return undefined;
  const existing = await findCrmContact(params.envelope);
  const username = telegramUsername(params.envelope);
  const now = new Date().toISOString();
  const role = params.senderIdentity === 'owner' || params.senderIdentity === 'manager' ? params.senderIdentity : 'unknown';
  const crmStatus =
    params.state.status === 'ready_for_channel_manager' || params.state.status === 'channel_manager_started'
      ? 'object_setup'
      : params.state.status === 'needs_operator'
        ? 'contact'
        : params.state.status === 'onboarding_started'
          ? 'contact'
          : 'waiting_object_data';
  const communicationStatus = params.state.status === 'needs_operator' ? 'needs_manual_reaction' : 'waiting_reply';
  const nextAction =
    params.state.status === 'ready_for_channel_manager'
      ? 'Открыть Менеджер каналов и начать подключение каналов.'
      : params.state.status === 'channel_manager_started'
        ? 'Проверить старт Менеджера каналов.'
        : params.state.status === 'needs_operator'
          ? 'Оператору нужно ответить вручную по онбордингу объекта.'
          : `Запросить: ${FIELD_LABELS[params.state.missing[0] ?? 'address']}.`;
  const notes = buildCrmNote({ existingNote: existing?.notes, state: params.state });

  try {
    if (existing?.id) {
      const { error } = await supabase
        .from('crm_contacts')
        .update({
          role,
          status: crmStatus,
          communication_status: communicationStatus,
          last_activity_at: now,
          next_action: nextAction,
          notes,
          city: params.state.city ?? null,
        })
        .eq('id', existing.id);
      return error ? undefined : existing.id;
    }

    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        name: telegramDisplayName(params.envelope),
        phone: null,
        contact: contactKey,
        telegram_username: username || null,
        email: null,
        role,
        source: 'telegram',
        property_count: 1,
        city: params.state.city ?? null,
        notes,
        status: crmStatus,
        communication_status: communicationStatus,
        last_activity_at: now,
        next_action: nextAction,
        next_action_due_at: null,
      })
      .select('id')
      .single();
    if (error || !data) return undefined;
    return String((data as { id?: unknown }).id ?? '') || undefined;
  } catch {
    return undefined;
  }
}

export async function processTelegramOwnerOnboarding(params: {
  envelope: InboundMessageEnvelope;
  chatId: number;
  senderIdentity: SenderIdentity;
}): Promise<OwnerOnboardingResult> {
  if (params.envelope.channel !== 'telegram') {
    const state = readStateFromSession(params.chatId);
    return { handled: false, replyText: '', status: state.status, missing: state.missing, state };
  }
  if (params.senderIdentity !== 'owner' && params.senderIdentity !== 'manager' && params.senderIdentity !== 'lead') {
    const state = readStateFromSession(params.chatId);
    return { handled: false, replyText: '', status: state.status, missing: state.missing, state };
  }

  const previous = readStateFromSession(params.chatId);
  const hasPhoto = Array.isArray((params.envelope.metadata as any)?.attachments)
    ? (params.envelope.metadata as any).attachments.some((attachment: any) => attachment?.type === 'photo')
    : false;

  const smartResult = await extractOnboardingFactsSmart({
    messageText: params.envelope.messageText ?? '',
    hasPhoto,
    missing: previous.missing,
    collected: previous,
    city: previous.city,
    photosIntent: previous.photos_intent,
    status: previous.status,
  });

  const fieldFacts: Partial<Record<OwnerOnboardingField, string>> = {};
  for (const field of Object.keys(FIELD_LABELS) as OwnerOnboardingField[]) {
    if (smartResult.facts[field]) fieldFacts[field] = smartResult.facts[field];
  }

  const merged: OwnerOnboardingState = {
    ...previous,
    ...fieldFacts,
    city: smartResult.facts.city ?? previous.city,
    photos_intent: smartResult.facts.photos_intent ?? previous.photos_intent,
    lastMessage: text(params.envelope.messageText, 600),
    channelManagerHref: CHANNEL_MANAGER_HREF,
    clarification_attempts: previous.clarification_attempts,
  };

  const extractedCount = countExtractedFields(fieldFacts, {
    photos_intent: merged.photos_intent,
    city: merged.city,
  });

  merged.clarification_attempts = nextClarificationAttempts({
    previousAttempts: previous.clarification_attempts,
    extractedCount,
    messageText: params.envelope.messageText ?? '',
    decision: smartResult.decision,
    previousStatus: previous.status,
  });

  merged.missing = missingFields(merged);
  merged.status = statusForState({
    previousStatus: previous.status,
    missing: merged.missing,
    extractedCount,
    messageText: params.envelope.messageText ?? '',
    decision: smartResult.decision,
    clarificationAttempts: merged.clarification_attempts,
  });

  if (smartResult.decision.clarification_question) {
    merged.lastClarificationQuestion = smartResult.decision.clarification_question;
  }

  patchAutonomousSessionCollectedData({
    chatId: params.chatId,
    channel: params.envelope.channel,
    set: {
      [`${SESSION_PREFIX}address`]: merged.address,
      [`${SESSION_PREFIX}property_name`]: merged.property_name,
      [`${SESSION_PREFIX}house_rules`]: merged.house_rules,
      [`${SESSION_PREFIX}wifi`]: merged.wifi,
      [`${SESSION_PREFIX}checkin_checkout`]: merged.checkin_checkout,
      [`${SESSION_PREFIX}photos`]: merged.photos,
      [`${SESSION_PREFIX}channels`]: merged.channels,
      [`${SESSION_PREFIX}city`]: merged.city,
      [`${SESSION_PREFIX}photos_intent`]: merged.photos_intent,
      [`${SESSION_PREFIX}clarification_attempts`]: String(merged.clarification_attempts),
      [`${SESSION_PREFIX}status`]: merged.status,
      [`${SESSION_PREFIX}missing`]: merged.missing.join(','),
      [`${SESSION_PREFIX}last_message`]: merged.lastMessage,
      [`${SESSION_PREFIX}last_clarification`]: merged.lastClarificationQuestion,
      [`${SESSION_PREFIX}channel_manager_href`]: CHANNEL_MANAGER_HREF,
    },
  });

  const crmContactId = await upsertCrmContact({
    envelope: params.envelope,
    senderIdentity: params.senderIdentity,
    state: merged,
  });

  return {
    handled: true,
    replyText: buildReply({
      status: merged.status,
      missing: merged.missing,
      facts: fieldFacts,
      decision: smartResult.decision,
      photosIntent: merged.photos_intent,
    }),
    replyMarkup: readyMarkup(merged.status),
    status: merged.status,
    missing: merged.missing,
    crmContactId,
    state: merged,
  };
}

export { extractFactsDeterministic, isIdentitySelectionText, detectsExplicitOperatorRequest };
