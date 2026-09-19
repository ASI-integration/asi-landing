import { CHANNEL_MANAGER_CONNECTION_METHOD_VALUES } from '@/lib/channel-manager-connection/types';
import { CHANNEL_MANAGER_PROVIDERS } from '@/lib/channel-connections/providers';

export const RU_SETUP_PATH = '/dashboard/channel-connections?setup=1';
export const CONNECTION_STEPS = ['Менеджер каналов', 'Площадки бронирования', 'Данные объекта', 'Готовность к запуску'] as const;
export const MANAGERS = [
  { value: 'bnovo', label: 'Bnovo' },
  { value: 'realtycalendar', label: 'RealtyCalendar' },
  { value: 'other', label: 'Другой сервис' },
  { value: 'none_yet', label: 'Пока нет менеджера каналов' },
] as const;
export const BOOKING_SITES = [
  ...CHANNEL_MANAGER_PROVIDERS.filter((p) => p.kind === 'ota_adapter' || p.kind === 'marketplace_adapter')
    .map((p) => ({ value: p.code as string, label: p.displayName })),
  { value: 'direct', label: 'Свой сайт / соцсети' },
  { value: 'other', label: 'Другие площадки' },
] as const;

export type RentalConnectionDraft = {
  step: number;
  manager: string;
  otherManager: string;
  channels: string[];
  name: string;
  address: string;
  description: string;
  rules: string;
  checkIn: string;
  checkOut: string;
  wifiName: string;
  wifiPassword: string;
  instructions: string;
  photosLater: boolean;
  communityMember: boolean;
};

export const EMPTY_CONNECTION: RentalConnectionDraft = {
  step: 0, manager: '', otherManager: '', channels: [], name: '', address: '', description: '',
  rules: '', checkIn: '14:00', checkOut: '12:00', wifiName: '', wifiPassword: '', instructions: '',
  photosLater: false, communityMember: false,
};

export function validateConnection(draft: RentalConnectionDraft, throughStep: number): string | null {
  if (!(CHANNEL_MANAGER_CONNECTION_METHOD_VALUES as readonly string[]).includes(draft.manager)) return 'Укажите ваш менеджер каналов.';
  if (draft.manager === 'other' && !draft.otherManager.trim()) return 'Напишите название сервиса.';
  if (throughStep >= 1 && !draft.channels.length) return 'Выберите хотя бы одну площадку или свой сайт / соцсети.';
  if (throughStep >= 2) {
    if (!draft.name || !draft.address || !draft.description || !draft.rules || !draft.instructions) return 'Заполните название, адрес, описание, правила и инструкции для гостей.';
    if (![draft.checkIn, draft.checkOut].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value))) return 'Укажите время заезда и выезда.';
  }
  return null;
}

/** Allowlisted owner input: IDs, readiness, activation and operator fields never come from the browser. */
export function parseConnectionInput(value: unknown): { step: number; values: Partial<RentalConnectionDraft> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректные данные.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['step', 'values'].includes(key))) throw new Error('Недопустимое поле.');
  if (!Number.isInteger(body.step) || Number(body.step) < 0 || Number(body.step) > 2) throw new Error('Недопустимый шаг.');
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw new Error('Заполните данные шага.');
  const allowed = body.step === 0 ? ['manager', 'otherManager'] : body.step === 1 ? ['channels'] :
    ['name', 'address', 'description', 'rules', 'checkIn', 'checkOut', 'wifiName', 'wifiPassword', 'instructions', 'photosLater', 'communityMember'];
  const values = body.values as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(values)) {
    if (!allowed.includes(key)) throw new Error('Недопустимое поле.');
    if (key === 'channels') {
      if (!Array.isArray(item) || item.length > BOOKING_SITES.length || item.some((site) => !BOOKING_SITES.some((s) => s.value === site))) throw new Error('Выберите площадки из списка.');
      clean[key] = [...new Set(item)];
    } else if (key === 'photosLater' || key === 'communityMember') {
      if (typeof item !== 'boolean') throw new Error('Некорректная отметка.');
      clean[key] = item;
    } else {
      if (typeof item !== 'string' || item.length > (['rules', 'instructions', 'description'].includes(key) ? 5000 : 300)) throw new Error('Проверьте длину текста.');
      clean[key] = item.trim();
    }
  }
  return { step: Number(body.step), values: clean };
}
