/** Narrow owner-edit policy. No live property, booking, credential, payment or channel keys. */
export const OWNER_CHANGE_FIELDS = {
  business: ['name', 'legalName'],
  owner: ['name', 'phone', 'email'],
  operations: ['checkInTime', 'checkOutTime', 'cleaningRule', 'linenRule', 'inspectionRule', 'maintenanceRule'],
} as const;

export type OwnerChangeSection = keyof typeof OWNER_CHANGE_FIELDS;
export type OwnerChangeInput = {
  requestId: string;
  section: OwnerChangeSection;
  values: Record<string, string>;
  expected: Record<string, unknown>;
};

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reject excess keys instead of silently trusting an arbitrary authenticated payload. */
export function parseOwnerChange(body: unknown): OwnerChangeInput {
  if (!isObject(body) || Object.keys(body).some((key) => !['requestId', 'section', 'values', 'expected'].includes(key))) {
    throw new Error('Некорректный формат запроса.');
  }
  const { requestId, section, values, expected } = body;
  if (typeof requestId !== 'string' || !UUID_RE.test(requestId)) throw new Error('Некорректный идентификатор изменения.');
  if (typeof section !== 'string' || !(section in OWNER_CHANGE_FIELDS)) throw new Error('Раздел недоступен для автоматического изменения.');
  if (!isObject(values) || !isObject(expected)) throw new Error('Некорректные данные.');
  const allowed = OWNER_CHANGE_FIELDS[section as OwnerChangeSection] as readonly string[];
  const names = Object.keys(values);
  if (!names.length || names.some((key) => !allowed.includes(key)) || JSON.stringify(expected).length > 8000) {
    throw new Error('Некорректные поля изменения.');
  }
  const clean: Record<string, string> = {};
  for (const key of names) {
    const value = values[key];
    if (typeof value !== 'string') throw new Error('Все поля должны быть строками.');
    const limit = key.toLowerCase().endsWith('rule') ? 2000 : 300;
    if (value.length > limit) throw new Error('Значение поля слишком длинное.');
    clean[key] = value.trim();
    if ((key === 'checkInTime' || key === 'checkOutTime') && clean[key] !== '' && !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(clean[key])) {
      throw new Error('Время должно быть в формате ЧЧ:ММ.');
    }
    if (key === 'email' && clean[key] && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(clean[key])) {
      throw new Error('Некорректный email.');
    }
  }
  return { requestId, section: section as OwnerChangeSection, values: clean, expected };
}
