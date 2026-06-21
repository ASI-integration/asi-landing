import { supabase } from '@/lib/supabase';
import {
  loadAutonomousSession,
  patchAutonomousSessionCollectedData,
} from './conversation-session-store';
import type { InboundMessageEnvelope } from './types';
import type { SenderIdentity, TelegramInlineKeyboardMarkup } from './communication-identity-routing';

export type OwnerOnboardingStatus =
  | 'onboarding_started'
  | 'missing_required_data'
  | 'ready_for_channel_manager'
  | 'channel_manager_started'
  | 'needs_operator';

type OwnerOnboardingField =
  | 'address'
  | 'property_name'
  | 'house_rules'
  | 'wifi'
  | 'checkin_checkout'
  | 'photos'
  | 'channels';

export type OwnerOnboardingState = Record<OwnerOnboardingField, string | undefined> & {
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  lastMessage: string;
  channelManagerHref: string;
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
  address: 'Пришлите адрес объекта одним сообщением.',
  property_name: 'Напишите название или тип объекта: квартира, апартаменты, дом или другой формат.',
  house_rules: 'Пришлите основные правила проживания: курение, животные, тишина, гости, залог.',
  wifi: 'Пришлите название сети и пароль Wi-Fi. Если Wi-Fi пока нет, так и напишите.',
  checkin_checkout: 'Напишите время заезда и выезда, например: заезд с 15:00, выезд до 11:00.',
  photos: 'Отправьте хотя бы одно фото объекта в этот чат.',
  channels: 'Выберите или напишите каналы: Авито, Суточно, Островок, Яндекс Путешествия, Airbnb, Booking.com, свой сайт.',
};

const CHANNEL_MANAGER_HREF = '/dashboard/channel-connections?source=telegram_onboarding';
const CHANNEL_MANAGER_URL = 'https://asi-global.ru/dashboard/channel-connections?source=telegram_onboarding';
const SESSION_PREFIX = 'owner_onboarding_';
const NOTE_HEADER = 'Онбординг ASI';

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeRu(value: unknown): string {
  return text(value, 2000)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s:@./+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const state = {
    address: sessionValue(collected, 'address'),
    property_name: sessionValue(collected, 'property_name'),
    house_rules: sessionValue(collected, 'house_rules'),
    wifi: sessionValue(collected, 'wifi'),
    checkin_checkout: sessionValue(collected, 'checkin_checkout'),
    photos: sessionValue(collected, 'photos'),
    channels: sessionValue(collected, 'channels'),
    status: (text(collected[`${SESSION_PREFIX}status`]) || 'onboarding_started') as OwnerOnboardingStatus,
    missing: [] as OwnerOnboardingField[],
    lastMessage: text(collected[`${SESSION_PREFIX}last_message`], 600),
    channelManagerHref: CHANNEL_MANAGER_HREF,
  };
  state.missing = missingFields(state);
  return state;
}

function missingFields(state: Partial<Record<OwnerOnboardingField, string | undefined>>): OwnerOnboardingField[] {
  return (Object.keys(FIELD_LABELS) as OwnerOnboardingField[]).filter((field) => !text(state[field]));
}

function looksLikeAddress(normalized: string): boolean {
  return /(адрес|ул\.?|улиц|просп|наб\.?|переул|шоссе|квартир|апартамент|москва|санкт|спб|казань|сочи|\d{1,4})/.test(normalized);
}

function extractChannels(raw: string): string | undefined {
  const n = normalizeRu(raw);
  const found: string[] = [];
  const add = (label: string) => {
    if (!found.includes(label)) found.push(label);
  };
  if (/авито|avito/.test(n)) add('Авито');
  if (/суточн|sutochno/.test(n)) add('Суточно');
  if (/остров|ostrovok/.test(n)) add('Островок');
  if (/яндекс/.test(n)) add('Яндекс Путешествия');
  if (/airbnb|эйр/.test(n)) add('Airbnb');
  if (/booking|букинг/.test(n)) add('Booking.com');
  if (/сайт|прям/.test(n)) add('свой сайт');
  if (/канал|площадк|ota|менеджер каналов/.test(n) && found.length === 0) return text(raw, 240);
  return found.length > 0 ? found.join(', ') : undefined;
}

function extractFacts(messageText: string, missing: OwnerOnboardingField[], hasPhoto: boolean): Partial<Record<OwnerOnboardingField, string>> {
  const raw = text(messageText, 1200);
  const n = normalizeRu(raw);
  const facts: Partial<Record<OwnerOnboardingField, string>> = {};

  if (hasPhoto || /\[photo\]|фото|изображен/.test(n)) facts.photos = hasPhoto ? 'Фото получено в Telegram' : raw;
  if (/wi fi|wi-fi|wifi|вай фай|вайфай|сеть|парол/.test(n)) facts.wifi = raw;
  if (/заезд|выезд|check in|check out|checkout|checkin|\b\d{1,2}[:.]\d{2}\b/.test(n)) facts.checkin_checkout = raw;
  if (/правил|курен|животн|тишин|залог|вечерин|гостям|нельзя|можно/.test(n)) facts.house_rules = raw;

  const channels = extractChannels(raw);
  if (channels) facts.channels = channels;

  if ((missing.includes('address') || /адрес/.test(n)) && looksLikeAddress(n) && !isIdentitySelectionText(raw)) {
    facts.address = raw;
  }

  if (
    (missing[0] === 'property_name' || /назван|тип|объект|квартир|апартамент|дом|студия/.test(n)) &&
    !isIdentitySelectionText(raw) &&
    !facts.address &&
    !facts.house_rules &&
    !facts.wifi &&
    !facts.checkin_checkout &&
    !facts.channels &&
    raw.length >= 3
  ) {
    facts.property_name = raw;
  }

  return facts;
}

function isIdentitySelectionText(messageText: string): boolean {
  const n = normalizeRu(messageText);
  return (
    n === 'хочу подключить asi' ||
    /хочу (подключить|добавить|настроить).*(квартир|объект|апартамент)/.test(n) ||
    /(сдаю|управляю).*(квартир|апартамент|объект)/.test(n) ||
    /хочу начать пользоваться/.test(n) ||
    n === 'я владелец / управляющий объекта' ||
    n === 'я владелец / управляющий' ||
    n === 'я владелец/управляющий объекта' ||
    n === 'я владелец/управляющий' ||
    n === 'я владелец управляющий объекта' ||
    n === 'я владелец управляющий' ||
    n === 'я владелец' ||
    n === 'я управляющий'
  );
}

function detectsChannelManagerStarted(messageText: string): boolean {
  const n = normalizeRu(messageText);
  return /начал|перешел|открыл|зашел|запустил/.test(n) && /менеджер каналов|канал/.test(n);
}

function statusForState(params: {
  previousStatus: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  extractedCount: number;
  messageText: string;
}): OwnerOnboardingStatus {
  if (params.previousStatus === 'needs_operator') return 'needs_operator';
  if (detectsChannelManagerStarted(params.messageText)) return 'channel_manager_started';
  if (params.missing.length === 0) return 'ready_for_channel_manager';
  if (params.extractedCount === 0 && !isIdentitySelectionText(params.messageText) && params.previousStatus !== 'onboarding_started') {
    return 'needs_operator';
  }
  if (params.extractedCount === 0 && !isIdentitySelectionText(params.messageText) && params.previousStatus === 'onboarding_started') {
    return 'needs_operator';
  }
  return params.extractedCount > 0 ? 'missing_required_data' : 'onboarding_started';
}

function missingListRu(missing: OwnerOnboardingField[]): string {
  return missing.map((field) => FIELD_LABELS[field]).join(', ');
}

function savedListRu(facts: Partial<Record<OwnerOnboardingField, string>>): string {
  return (Object.keys(facts) as OwnerOnboardingField[]).map((field) => FIELD_LABELS[field]).join(', ');
}

function statusLabelRu(status: OwnerOnboardingStatus): string {
  switch (status) {
    case 'onboarding_started':
      return 'онбординг начат';
    case 'missing_required_data':
      return 'не хватает данных';
    case 'ready_for_channel_manager':
      return 'готов к Менеджеру каналов';
    case 'channel_manager_started':
      return 'Менеджер каналов открыт';
    case 'needs_operator':
      return 'нужна реакция оператора';
    default:
      return 'не хватает данных';
  }
}

function buildReply(params: {
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingField[];
  facts: Partial<Record<OwnerOnboardingField, string>>;
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
  const saved = savedListRu(params.facts);
  if (!saved && params.status === 'onboarding_started' && next === 'address') {
    return 'Поняла. Помогу подключить объект к ASI.\n\nДля начала укажите адрес объекта.';
  }
  const intro = saved
    ? `Сохранила: ${saved}.`
    : 'Начнём подключение объекта к ASI. Я буду спрашивать только то, чего не хватает.';
  return [
    intro,
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
    `Статус: ${statusLabelRu(params.state.status)}`,
    `Не хватает: ${params.state.missing.length ? missingListRu(params.state.missing) : 'ничего'}`,
    `Последнее сообщение: ${params.state.lastMessage || 'нет текста'}`,
    `Менеджер каналов: ${CHANNEL_MANAGER_HREF}`,
  ].join('\n');
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
        city: null,
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
  const facts = extractFacts(params.envelope.messageText ?? '', previous.missing, hasPhoto);
  const merged: OwnerOnboardingState = {
    ...previous,
    ...facts,
    lastMessage: text(params.envelope.messageText, 600),
    channelManagerHref: CHANNEL_MANAGER_HREF,
  };
  merged.missing = missingFields(merged);
  merged.status = statusForState({
    previousStatus: previous.status,
    missing: merged.missing,
    extractedCount: Object.keys(facts).length,
    messageText: params.envelope.messageText ?? '',
  });

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
      [`${SESSION_PREFIX}status`]: merged.status,
      [`${SESSION_PREFIX}missing`]: merged.missing.join(','),
      [`${SESSION_PREFIX}last_message`]: merged.lastMessage,
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
    replyText: buildReply({ status: merged.status, missing: merged.missing, facts }),
    replyMarkup: readyMarkup(merged.status),
    status: merged.status,
    missing: merged.missing,
    crmContactId,
    state: merged,
  };
}
