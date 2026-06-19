import {
  CRM_ROLE_LABELS,
  CRM_ROLE_VALUES,
  CRM_SOURCE_LABELS,
  CRM_SOURCE_VALUES,
  CrmContact,
  CrmRole,
  CrmSource,
} from './types';

export const CRM_SUGGESTION_LIMIT = 10;

export type CrmSuggestionField =
  | 'name'
  | 'phone'
  | 'telegramUsername'
  | 'email'
  | 'city'
  | 'source'
  | 'role'
  | 'nextStep';

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function fieldValues(contacts: CrmContact[], field: CrmSuggestionField): string[] {
  switch (field) {
    case 'name':
      return contacts.map((contact) => contact.name);
    case 'phone':
      return contacts.map((contact) => contact.phone);
    case 'telegramUsername':
      return contacts.map((contact) => contact.telegramUsername);
    case 'email':
      return contacts.map((contact) => (contact.email ?? '').trim()).filter(Boolean);
    case 'city':
      return contacts.map((contact) => contact.city);
    case 'source':
      return contacts.map((contact) => CRM_SOURCE_LABELS[contact.source]);
    case 'role':
      return contacts.map((contact) => CRM_ROLE_LABELS[contact.role]);
    case 'nextStep':
      return contacts.map((contact) => contact.nextStep);
    default:
      return [];
  }
}

export function collectCrmFieldValues(contacts: CrmContact[], field: CrmSuggestionField): string[] {
  return uniqueNonEmpty(fieldValues(contacts, field));
}

export function getCrmSuggestions(
  contacts: CrmContact[],
  field: CrmSuggestionField,
  query: string,
  limit = CRM_SUGGESTION_LIMIT
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const values = collectCrmFieldValues(contacts, field);
  const filtered = normalizedQuery
    ? values.filter((value) => value.toLowerCase().includes(normalizedQuery))
    : values;

  return filtered.slice(0, limit);
}

function resolveEnumInput<T extends readonly string[]>(
  value: string,
  values: T,
  labels: Record<T[number], string>,
  fallback: T[number]
): T[number] {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (values.includes(trimmed as T[number])) return trimmed as T[number];

  const byLabel = (Object.entries(labels) as Array<[T[number], string]>).find(
    ([, label]) => label.toLowerCase() === trimmed.toLowerCase()
  );
  return byLabel ? byLabel[0] : fallback;
}

export function resolveCrmRoleInput(value: string): CrmRole {
  return resolveEnumInput(value, CRM_ROLE_VALUES, CRM_ROLE_LABELS, 'unknown');
}

export function resolveCrmSourceInput(value: string): CrmSource {
  return resolveEnumInput(value, CRM_SOURCE_VALUES, CRM_SOURCE_LABELS, 'manual');
}
