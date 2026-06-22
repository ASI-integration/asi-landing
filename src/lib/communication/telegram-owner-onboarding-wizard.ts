import type { TelegramInlineKeyboardMarkup } from './communication-identity-routing';

export const WIZARD_CALLBACK_PREFIX = 'obv2:';

export const WIZARD_TOTAL_STEPS = 8;

export type OwnerOnboardingWizardField =
  | 'address'
  | 'object_type'
  | 'checkin_time'
  | 'checkout_time'
  | 'channels'
  | 'rules'
  | 'wifi'
  | 'photos';

export const WIZARD_FIELD_ORDER: OwnerOnboardingWizardField[] = [
  'address',
  'object_type',
  'checkin_time',
  'checkout_time',
  'channels',
  'rules',
  'wifi',
  'photos',
];

export const WIZARD_FIELD_LABELS: Record<OwnerOnboardingWizardField, string> = {
  address: 'Адрес',
  object_type: 'Тип',
  checkin_time: 'Заезд',
  checkout_time: 'Выезд',
  channels: 'Каналы',
  rules: 'Правила',
  wifi: 'Wi-Fi',
  photos: 'Фото',
};

export const OBJECT_TYPE_OPTIONS = ['Квартира', 'Апартаменты', 'Дом', 'Комната', 'Другое'] as const;

export const CHECKIN_TIME_OPTIONS = ['12:00', '13:00', '14:00', '15:00'] as const;
export const CHECKOUT_TIME_OPTIONS = ['10:00', '11:00', '12:00', '13:00'] as const;

/** @deprecated Use CHECKIN_TIME_OPTIONS or CHECKOUT_TIME_OPTIONS */
export const TIME_OPTIONS = CHECKIN_TIME_OPTIONS;

export const CHANNEL_OPTIONS = [
  { id: 'sutochno', label: 'Суточно' },
  { id: 'avito', label: 'Авито' },
  { id: 'ostrovok', label: 'Островок' },
  { id: 'cian', label: 'ЦИАН' },
  { id: '101hotel', label: '101Отель' },
  { id: 'ozon', label: 'Ozon Travel' },
  { id: 'yandex', label: 'Яндекс Путешествия' },
  { id: 'otello', label: 'Отелло' },
  { id: 'bronevik', label: 'Броневик' },
  { id: 'kvartirka', label: 'Квартирка' },
] as const;

export const RULE_OPTIONS = [
  { id: 'no_smoke', label: 'Не курить' },
  { id: 'no_parties', label: 'Без вечеринок' },
  { id: 'kids_ok', label: 'Можно с детьми' },
  { id: 'pets_ok', label: 'Можно с животными' },
  { id: 'deposit', label: 'Залог обязателен' },
  { id: 'quiet_hours', label: 'Тихие часы после 22:00' },
] as const;

export type WizardStructuredState = {
  object_type?: string;
  checkin_time?: string;
  checkout_time?: string;
  channels: string[];
  rules: string[];
  wifi_name?: string;
  wifi_password?: string;
  wifi_skipped?: boolean;
  photos_count: number;
  awaiting_custom?: 'checkin_time' | 'checkout_time';
  channels_draft: string[];
  rules_draft: string[];
};

export type WizardCallbackResult =
  | { kind: 'noop' }
  | { kind: 'set_field'; field: OwnerOnboardingWizardField; value: string }
  | { kind: 'await_custom'; field: 'checkin_time' | 'checkout_time' }
  | { kind: 'toggle_channel'; channelId: string }
  | { kind: 'confirm_channels' }
  | { kind: 'toggle_rule'; ruleId: string }
  | { kind: 'confirm_rules' }
  | { kind: 'wifi_later' }
  | { kind: 'photo_later' };

function text(value: unknown, max = 400): string {
  return String(value ?? '').trim().slice(0, max);
}

export function isWizardCallbackData(data: unknown): boolean {
  return text(data, 64).startsWith(WIZARD_CALLBACK_PREFIX);
}

export function parseWizardCallback(data: unknown): WizardCallbackResult {
  const raw = text(data, 64);
  if (!raw.startsWith(WIZARD_CALLBACK_PREFIX)) return { kind: 'noop' };

  const parts = raw.slice(WIZARD_CALLBACK_PREFIX.length).split(':');
  const action = parts[0] ?? '';

  switch (action) {
    case 'type':
      return { kind: 'set_field', field: 'object_type', value: parts.slice(1).join(':') };
    case 'chk_in':
      if (parts[1] === 'custom') return { kind: 'await_custom', field: 'checkin_time' };
      return { kind: 'set_field', field: 'checkin_time', value: parts.slice(1).join(':') };
    case 'chk_out':
      if (parts[1] === 'custom') return { kind: 'await_custom', field: 'checkout_time' };
      return { kind: 'set_field', field: 'checkout_time', value: parts.slice(1).join(':') };
    case 'ch_t':
      return { kind: 'toggle_channel', channelId: parts[1] ?? '' };
    case 'ch_done':
      return { kind: 'confirm_channels' };
    case 'rl_t':
      return { kind: 'toggle_rule', ruleId: parts[1] ?? '' };
    case 'rl_done':
      return { kind: 'confirm_rules' };
    case 'wifi_later':
      return { kind: 'wifi_later' };
    case 'photo_later':
      return { kind: 'photo_later' };
    default:
      return { kind: 'noop' };
  }
}

export function channelLabelById(id: string): string | undefined {
  return CHANNEL_OPTIONS.find((item) => item.id === id)?.label;
}

export function ruleLabelById(id: string): string | undefined {
  return RULE_OPTIONS.find((item) => item.id === id)?.label;
}

export function channelIdsFromLabels(labels: string[]): string[] {
  const normalized = labels.map((item) => text(item).toLowerCase());
  return CHANNEL_OPTIONS.filter((item) => normalized.includes(item.label.toLowerCase())).map((item) => item.id);
}

export function ruleIdsFromLabels(labels: string[]): string[] {
  const normalized = labels.map((item) => text(item).toLowerCase());
  return RULE_OPTIONS.filter((item) => normalized.includes(item.label.toLowerCase())).map((item) => item.id);
}

export function missingWizardFields(state: {
  address?: string;
  object_type?: string;
  checkin_time?: string;
  checkout_time?: string;
  channels?: string[];
  rules?: string[];
  wifi_name?: string;
  wifi_password?: string;
  wifi_skipped?: boolean;
  photos?: string;
  photos_intent?: 'now' | 'later' | null;
  photos_count?: number;
}): OwnerOnboardingWizardField[] {
  return WIZARD_FIELD_ORDER.filter((field) => {
    switch (field) {
      case 'address':
        return !text(state.address);
      case 'object_type':
        return !text(state.object_type);
      case 'checkin_time':
        return !text(state.checkin_time);
      case 'checkout_time':
        return !text(state.checkout_time);
      case 'channels':
        return !(state.channels?.length ?? 0);
      case 'rules':
        return !(state.rules?.length ?? 0);
      case 'wifi':
        return !state.wifi_skipped && !(text(state.wifi_name) || text(state.wifi_password));
      case 'photos':
        return !text(state.photos) && state.photos_intent !== 'later' && !(state.photos_count ?? 0);
      default:
        return true;
    }
  });
}

export function wizardStepNumber(completedCount: number): number {
  return Math.min(Math.max(completedCount + 1, 1), WIZARD_TOTAL_STEPS);
}

export function wizardCompletedCount(state: Parameters<typeof missingWizardFields>[0]): number {
  return WIZARD_TOTAL_STEPS - missingWizardFields(state).length;
}

export function buildWizardProgressBlock(params: {
  completedCount: number;
  readinessPercent: number;
  checklist?: Array<{ label: string; done: boolean }>;
}): string {
  const step = wizardStepNumber(params.completedCount);
  const lines = [`Шаг ${step} из ${WIZARD_TOTAL_STEPS}`, `Готовность объекта: ${params.readinessPercent}%`];
  if (params.checklist?.length) {
    lines.push('');
    lines.push(...params.checklist.map((item) => `${item.label} ${item.done ? '✓' : '✗'}`));
  }
  return lines.join('\n');
}

export function buildWizardChecklist(state: Parameters<typeof missingWizardFields>[0]): Array<{ label: string; done: boolean }> {
  const missing = new Set(missingWizardFields(state));
  return WIZARD_FIELD_ORDER.map((field) => ({
    label: WIZARD_FIELD_LABELS[field],
    done: !missing.has(field),
  }));
}

function multiSelectButtonLabel(selected: boolean, label: string): string {
  return selected ? `✅ ${label}` : label;
}

function callbackData(action: string, value?: string): string {
  const raw = value ? `${WIZARD_CALLBACK_PREFIX}${action}:${value}` : `${WIZARD_CALLBACK_PREFIX}${action}`;
  return raw.slice(0, 64);
}

export function buildObjectTypeKeyboard(): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  for (let i = 0; i < OBJECT_TYPE_OPTIONS.length; i += 2) {
    const row = OBJECT_TYPE_OPTIONS.slice(i, i + 2).map((label) => ({
      text: label,
      callback_data: callbackData('type', label),
    }));
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export function buildTimeKeyboard(kind: 'checkin_time' | 'checkout_time'): TelegramInlineKeyboardMarkup {
  const action = kind === 'checkin_time' ? 'chk_in' : 'chk_out';
  const options = kind === 'checkin_time' ? CHECKIN_TIME_OPTIONS : CHECKOUT_TIME_OPTIONS;
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(
      options.slice(i, i + 2).map((time) => ({
        text: time,
        callback_data: callbackData(action, time),
      })),
    );
  }
  rows.push([{ text: 'Свой вариант', callback_data: callbackData(action, 'custom') }]);
  return { inline_keyboard: rows };
}

export function buildChannelsKeyboard(selectedIds: string[]): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  for (const item of CHANNEL_OPTIONS) {
    const selected = selectedIds.includes(item.id);
    rows.push([
      {
        text: multiSelectButtonLabel(selected, item.label),
        callback_data: callbackData('ch_t', item.id),
      },
    ]);
  }
  rows.push([{ text: 'Готово', callback_data: callbackData('ch_done') }]);
  return { inline_keyboard: rows };
}

export function buildRulesKeyboard(selectedIds: string[]): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  for (const item of RULE_OPTIONS) {
    const selected = selectedIds.includes(item.id);
    rows.push([
      {
        text: multiSelectButtonLabel(selected, item.label),
        callback_data: callbackData('rl_t', item.id),
      },
    ]);
  }
  rows.push([{ text: 'Готово', callback_data: callbackData('rl_done') }]);
  return { inline_keyboard: rows };
}

export function buildWifiKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Добавлю позже', callback_data: callbackData('wifi_later') }]],
  };
}

export function buildPhotosKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Добавлю позже', callback_data: callbackData('photo_later') }]],
  };
}

export function buildWizardStepPrompt(field: OwnerOnboardingWizardField): string {
  switch (field) {
    case 'address':
      return [
        'Укажите адрес объекта.',
        'Например:',
        'Санкт-Петербург, Лиговский пр., 108',
      ].join('\n');
    case 'object_type':
      return 'Выберите тип объекта:';
    case 'checkin_time':
      return 'Выберите время заезда:';
    case 'checkout_time':
      return 'Выберите время выезда:';
    case 'channels':
      return 'Выберите каналы бронирования. Можно отметить несколько, затем нажмите «Готово».';
    case 'rules':
      return 'Выберите правила проживания. Можно отметить несколько, затем нажмите «Готово».';
    case 'wifi':
      return 'Пришлите название сети и пароль Wi-Fi одним сообщением.\nНапример: ASI_Guest, пароль 12345678';
    case 'photos':
      return 'Отправьте хотя бы одно фото объекта в этот чат или нажмите «Добавлю позже».';
    default:
      return '';
  }
}

export function buildWizardStepKeyboard(
  field: OwnerOnboardingWizardField,
  draft?: Pick<WizardStructuredState, 'channels_draft' | 'rules_draft'>,
): TelegramInlineKeyboardMarkup | undefined {
  switch (field) {
    case 'object_type':
      return buildObjectTypeKeyboard();
    case 'checkin_time':
      return buildTimeKeyboard('checkin_time');
    case 'checkout_time':
      return buildTimeKeyboard('checkout_time');
    case 'channels':
      return buildChannelsKeyboard(draft?.channels_draft ?? []);
    case 'rules':
      return buildRulesKeyboard(draft?.rules_draft ?? []);
    case 'wifi':
      return buildWifiKeyboard();
    case 'photos':
      return buildPhotosKeyboard();
    default:
      return undefined;
  }
}

export function fieldSavedAckRu(field: OwnerOnboardingWizardField): string {
  switch (field) {
    case 'object_type':
      return '✓ Тип объекта сохранён';
    case 'checkin_time':
      return '✓ Время заезда сохранено';
    case 'checkout_time':
      return '✓ Время выезда сохранено';
    case 'channels':
      return '✓ Каналы сохранены';
    case 'rules':
      return '✓ Правила сохранены';
    case 'wifi':
      return '✓ Wi-Fi сохранён';
    case 'photos':
      return '✓ Фото сохранены';
    default:
      return '✓ Данные сохранены';
  }
}

export function parseWifiInput(raw: string): { wifi_name?: string; wifi_password?: string } {
  const value = text(raw, 400);
  if (!value) return {};
  const commaParts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    return {
      wifi_name: commaParts[0],
      wifi_password: commaParts.slice(1).join(', ').replace(/^пароль\s+/i, ''),
    };
  }
  const passwordMatch = value.match(/(.+?)\s+(?:пароль|pass(?:word)?)\s+(.+)/i);
  if (passwordMatch) {
    return { wifi_name: passwordMatch[1].trim(), wifi_password: passwordMatch[2].trim() };
  }
  const slashParts = value.split('/').map((part) => part.trim()).filter(Boolean);
  if (slashParts.length >= 2) {
    return { wifi_name: slashParts[0], wifi_password: slashParts.slice(1).join(' / ') };
  }
  return { wifi_name: value };
}

export const CUSTOM_TIME_INPUT_PROMPT_RU = 'Введите время в формате 11:00 или 11 утра.';

function normalizeHourMinute(hour: number, minute = 0): string | undefined {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseCustomTimeInput(raw: string): string | undefined {
  const value = text(raw, 40).toLowerCase().replace(/,/g, ' ');

  const colonMatch = value.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s|$)/);
  if (colonMatch) {
    return normalizeHourMinute(Number(colonMatch[1]), Number(colonMatch[2]));
  }

  const morningMatch = value.match(/(?:^|\s)(?:в\s+|до\s+)?(\d{1,2})\s*(?:утра|утром)(?:\s|$|[,.])/);
  if (morningMatch) {
    return normalizeHourMinute(Number(morningMatch[1]));
  }

  const morningShortMatch = value.match(/(\d{1,2})\s*(?:утра|утром)(?:\s|$|[,.])/);
  if (morningShortMatch) {
    return normalizeHourMinute(Number(morningShortMatch[1]));
  }

  const prepMatch = value.match(/(?:^|\s)(?:в|до)\s+(\d{1,2})(?:\s|$|[:.])/);
  if (prepMatch) {
    return normalizeHourMinute(Number(prepMatch[1]));
  }

  const bareMatch = value.match(/^(\d{1,2})$/);
  if (bareMatch) {
    return normalizeHourMinute(Number(bareMatch[1]));
  }

  return undefined;
}

export function labelsFromChannelIds(ids: string[]): string[] {
  return ids.map((id) => channelLabelById(id)).filter(Boolean) as string[];
}

export function labelsFromRuleIds(ids: string[]): string[] {
  return ids.map((id) => ruleLabelById(id)).filter(Boolean) as string[];
}
