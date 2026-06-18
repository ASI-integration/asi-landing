/**
 * Property setup (подготовка объекта) — owner-facing черновик.
 *
 * Единый источник правды по форме подготовки объекта. Хранится в JSONB
 * (property_setup_profiles.data). Ключевые поля дополнительно зеркалируются
 * в properties / property_master_cards для совместимости с остальной системой.
 *
 * Важно: список каналов здесь — только подготовительный выбор владельца.
 * Реальное подключение OTA и active mode тут не включаются.
 */

import type { UpdateMasterCardInput, UpdatePropertyInput } from '@/lib/ops-foundation/types';

export type PropertySetupChannelStatus = 'not_connected' | 'needs_credentials' | 'preparing' | 'shadow';

export interface PropertySetupChannelSelection {
  code: string;
  status: PropertySetupChannelStatus;
}

export interface PropertySetupUnit {
  name: string;
  count: string;
  capacity: string;
  bedType: string;
  amenities: string;
}

export interface PropertySetupBasic {
  title: string;
  propertyType: string;
  city: string;
  shortSummary: string;
}

export interface PropertySetupAddress {
  line: string;
  district: string;
  accessNote: string;
}

export interface PropertySetupDescription {
  full: string;
  shortForOta: string;
  advantages: string;
}

export interface PropertySetupRules {
  smoking: string;
  pets: string;
  parties: string;
  children: string;
  deposit: string;
  documents: string;
  quietHours: string;
}

export interface PropertySetupCheckInOut {
  checkInTime: string;
  checkOutTime: string;
  checkInInstructions: string;
  checkOutInstructions: string;
}

export interface PropertySetupWifi {
  wifiName: string;
  wifiPassword: string;
  entryInstructions: string;
  keysInfo: string;
  householdInstructions: string;
}

export interface PropertySetupPricing {
  basePricePerNight: string;
  minNights: string;
  extraGuestFee: string;
  cleaningFee: string;
  deposit: string;
}

export interface PropertySetupData {
  basic: PropertySetupBasic;
  address: PropertySetupAddress;
  units: PropertySetupUnit[];
  description: PropertySetupDescription;
  rules: PropertySetupRules;
  checkInOut: PropertySetupCheckInOut;
  wifi: PropertySetupWifi;
  pricing: PropertySetupPricing;
  channels: PropertySetupChannelSelection[];
}

export const SETUP_CHANNEL_CATALOG: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'yandex_travel', label: 'Яндекс Путешествия' },
  { code: 'ostrovok', label: 'Островок' },
  { code: 'sutochno', label: 'Суточно' },
  { code: 'avito_travel', label: 'Авито' },
  { code: 'one_zero_one_hotels', label: '101Hotels' },
  { code: 'bronevik_mts_travel', label: 'Bronevik / МТС Travel' },
  { code: 'cian_daily', label: 'Циан' },
];

export const SETUP_CHANNEL_STATUS_LABELS: Record<PropertySetupChannelStatus, string> = {
  not_connected: 'Не подключён',
  needs_credentials: 'Нужны доступы',
  preparing: 'Готовится',
  shadow: 'Теневой режим',
};

const VALID_CHANNEL_STATUSES: PropertySetupChannelStatus[] = [
  'not_connected',
  'needs_credentials',
  'preparing',
  'shadow',
];

const VALID_CHANNEL_CODES = new Set(SETUP_CHANNEL_CATALOG.map((channel) => channel.code));

export function createEmptySetupData(): PropertySetupData {
  return {
    basic: { title: '', propertyType: '', city: '', shortSummary: '' },
    address: { line: '', district: '', accessNote: '' },
    units: [],
    description: { full: '', shortForOta: '', advantages: '' },
    rules: { smoking: '', pets: '', parties: '', children: '', deposit: '', documents: '', quietHours: '' },
    checkInOut: { checkInTime: '', checkOutTime: '', checkInInstructions: '', checkOutInstructions: '' },
    wifi: { wifiName: '', wifiPassword: '', entryInstructions: '', keysInfo: '', householdInstructions: '' },
    pricing: { basePricePerNight: '', minNights: '', extraGuestFee: '', cleaningFee: '', deposit: '' },
    channels: SETUP_CHANNEL_CATALOG.map((channel) => ({ code: channel.code, status: 'not_connected' })),
  };
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function normalizeUnit(value: unknown): PropertySetupUnit {
  const record = asRecord(value);
  return {
    name: str(record.name),
    count: str(record.count),
    capacity: str(record.capacity),
    bedType: str(record.bedType),
    amenities: str(record.amenities),
  };
}

function normalizeChannelStatus(value: unknown): PropertySetupChannelStatus {
  return VALID_CHANNEL_STATUSES.includes(value as PropertySetupChannelStatus)
    ? (value as PropertySetupChannelStatus)
    : 'not_connected';
}

function normalizeChannels(value: unknown): PropertySetupChannelSelection[] {
  const byCode = new Map<string, PropertySetupChannelStatus>();
  if (Array.isArray(value)) {
    for (const raw of value) {
      const record = asRecord(raw);
      const code = str(record.code);
      if (VALID_CHANNEL_CODES.has(code)) {
        byCode.set(code, normalizeChannelStatus(record.status));
      }
    }
  }
  return SETUP_CHANNEL_CATALOG.map((channel) => ({
    code: channel.code,
    status: byCode.get(channel.code) ?? 'not_connected',
  }));
}

/** Безопасно приводит произвольный JSON к PropertySetupData (пустые данные не падают). */
export function normalizeSetupData(value: unknown): PropertySetupData {
  const root = asRecord(value);
  const basic = asRecord(root.basic);
  const address = asRecord(root.address);
  const description = asRecord(root.description);
  const rules = asRecord(root.rules);
  const checkInOut = asRecord(root.checkInOut);
  const wifi = asRecord(root.wifi);
  const pricing = asRecord(root.pricing);

  return {
    basic: {
      title: str(basic.title),
      propertyType: str(basic.propertyType),
      city: str(basic.city),
      shortSummary: str(basic.shortSummary),
    },
    address: {
      line: str(address.line),
      district: str(address.district),
      accessNote: str(address.accessNote),
    },
    units: Array.isArray(root.units) ? root.units.map(normalizeUnit) : [],
    description: {
      full: str(description.full),
      shortForOta: str(description.shortForOta),
      advantages: str(description.advantages),
    },
    rules: {
      smoking: str(rules.smoking),
      pets: str(rules.pets),
      parties: str(rules.parties),
      children: str(rules.children),
      deposit: str(rules.deposit),
      documents: str(rules.documents),
      quietHours: str(rules.quietHours),
    },
    checkInOut: {
      checkInTime: str(checkInOut.checkInTime),
      checkOutTime: str(checkInOut.checkOutTime),
      checkInInstructions: str(checkInOut.checkInInstructions),
      checkOutInstructions: str(checkInOut.checkOutInstructions),
    },
    wifi: {
      wifiName: str(wifi.wifiName),
      wifiPassword: str(wifi.wifiPassword),
      entryInstructions: str(wifi.entryInstructions),
      keysInfo: str(wifi.keysInfo),
      householdInstructions: str(wifi.householdInstructions),
    },
    pricing: {
      basePricePerNight: str(pricing.basePricePerNight),
      minNights: str(pricing.minNights),
      extraGuestFee: str(pricing.extraGuestFee),
      cleaningFee: str(pricing.cleaningFee),
      deposit: str(pricing.deposit),
    },
    channels: normalizeChannels(root.channels),
  };
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

// ─── Completion helpers ──────────────────────────────────────────────────────

export function isSetupBasicComplete(d: PropertySetupData): boolean {
  return hasText(d.basic.title) && hasText(d.basic.city);
}

export function isSetupAddressComplete(d: PropertySetupData): boolean {
  return hasText(d.address.line) && hasText(d.basic.city);
}

export function isSetupUnitsComplete(d: PropertySetupData): boolean {
  return d.units.some((unit) => hasText(unit.name));
}

export function isSetupDescriptionComplete(d: PropertySetupData): boolean {
  return hasText(d.description.full) || hasText(d.basic.shortSummary) || hasText(d.description.shortForOta);
}

export function isSetupRulesComplete(d: PropertySetupData): boolean {
  return [
    d.rules.smoking,
    d.rules.pets,
    d.rules.parties,
    d.rules.children,
    d.rules.deposit,
    d.rules.documents,
    d.rules.quietHours,
  ].some(hasText);
}

export function isSetupCheckInComplete(d: PropertySetupData): boolean {
  const hasTimes = hasText(d.checkInOut.checkInTime) && hasText(d.checkInOut.checkOutTime);
  const hasInstructions =
    hasText(d.checkInOut.checkInInstructions) && hasText(d.checkInOut.checkOutInstructions);
  return hasTimes || hasInstructions;
}

export function isSetupWifiComplete(d: PropertySetupData): boolean {
  return (
    hasText(d.wifi.wifiName) ||
    hasText(d.wifi.entryInstructions) ||
    hasText(d.wifi.keysInfo) ||
    hasText(d.wifi.householdInstructions)
  );
}

export function isSetupPricingComplete(d: PropertySetupData): boolean {
  return hasText(d.pricing.basePricePerNight);
}

export function isSetupChannelsSelected(d: PropertySetupData): boolean {
  return d.channels.some((channel) => channel.status !== 'not_connected');
}

// ─── Mirror в properties / property_master_cards ─────────────────────────────

function composeRules(rules: PropertySetupRules): string {
  const lines: Array<[string, string]> = [
    ['Курение', rules.smoking],
    ['Животные', rules.pets],
    ['Вечеринки', rules.parties],
    ['Дети', rules.children],
    ['Депозит', rules.deposit],
    ['Документы', rules.documents],
    ['Тихие часы', rules.quietHours],
  ];
  return lines
    .filter(([, value]) => hasText(value))
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join('\n');
}

function composeCheckIn(io: PropertySetupCheckInOut): string {
  const parts: string[] = [];
  if (hasText(io.checkInTime)) parts.push(`Заезд с ${io.checkInTime.trim()}`);
  if (hasText(io.checkInInstructions)) parts.push(io.checkInInstructions.trim());
  return parts.join('. ');
}

function composeCheckOut(io: PropertySetupCheckInOut): string {
  const parts: string[] = [];
  if (hasText(io.checkOutTime)) parts.push(`Выезд до ${io.checkOutTime.trim()}`);
  if (hasText(io.checkOutInstructions)) parts.push(io.checkOutInstructions.trim());
  return parts.join('. ');
}

/** Возвращает обрезанную строку или undefined — чтобы НЕ затирать существующие данные пустыми значениями. */
function present(value: string): string | undefined {
  return hasText(value) ? value.trim() : undefined;
}

export interface SetupMirrorUpdates {
  property: UpdatePropertyInput;
  masterCard: UpdateMasterCardInput;
}

/**
 * Строит зеркальные обновления для properties и property_master_cards.
 * Эти данные нужны существующим частям системы (мастер-карточка, гость-агент,
 * расчёт готовности). Полный черновик при этом сохраняется отдельно в JSON.
 *
 * Пустые поля передаются как undefined и НЕ перезаписывают существующие данные
 * (репозиторий отбрасывает undefined), чтобы сохранение черновика не стирало
 * ранее заполненную мастер-карточку.
 */
export function buildSetupMirrorUpdates(d: PropertySetupData): SetupMirrorUpdates {
  return {
    property: {
      title: present(d.basic.title),
      city: present(d.basic.city),
      address: present(d.address.line),
    },
    masterCard: {
      shortDescription: present(d.basic.shortSummary) ?? present(d.description.shortForOta),
      fullDescription: present(d.description.full),
      houseRules: present(composeRules(d.rules)),
      checkInInstructions: present(composeCheckIn(d.checkInOut)),
      checkOutInstructions: present(composeCheckOut(d.checkInOut)),
      wifiName: present(d.wifi.wifiName),
      wifiPassword: present(d.wifi.wifiPassword),
    },
  };
}

/**
 * Первичное заполнение формы из существующих данных объекта/мастер-карточки,
 * когда отдельного черновика подготовки ещё нет.
 */
export function setupDataFromExisting(
  property: { title?: string | null; city?: string | null; address?: string | null } | null,
  masterCard:
    | {
        shortDescription?: string | null;
        fullDescription?: string | null;
        checkInInstructions?: string | null;
        checkOutInstructions?: string | null;
        wifiName?: string | null;
        wifiPassword?: string | null;
      }
    | null,
): PropertySetupData {
  const base = createEmptySetupData();
  base.basic.title = str(property?.title);
  base.basic.city = str(property?.city);
  base.basic.shortSummary = str(masterCard?.shortDescription);
  base.address.line = str(property?.address);
  base.description.full = str(masterCard?.fullDescription);
  base.checkInOut.checkInInstructions = str(masterCard?.checkInInstructions);
  base.checkInOut.checkOutInstructions = str(masterCard?.checkOutInstructions);
  base.wifi.wifiName = str(masterCard?.wifiName);
  base.wifi.wifiPassword = str(masterCard?.wifiPassword);
  return base;
}
