import { normalizePilotRolloutStorageStatus } from './pilot-rollout';
import {
  CRM_COMMUNICATION_STATUS_VALUES,
  CRM_ROLE_VALUES,
  CRM_SOURCE_VALUES,
  CRM_STATUS_VALUES,
  CrmCommunicationStatus,
  CrmContactInput,
  CrmRole,
  CrmSource,
  CrmStatus,
} from './types';

export type NormalizedCrmContactInput = {
  name: string;
  phone: string;
  telegramUsername: string;
  email: string | null;
  role: CrmRole;
  source: CrmSource;
  objectsCount: number;
  city: string;
  note: string;
  status: CrmStatus;
  communicationStatus: CrmCommunicationStatus;
  lastContactAt: string | null;
  nextStep: string;
  nextActionAt: string | null;
};

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function optionalEmail(value: unknown): string | null {
  const email = text(value, 254);
  return email ? email : null;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]): T[number] {
  return typeof value === 'string' && values.includes(value) ? value : fallback;
}

function dateValue(value: unknown): string | null {
  const raw = text(value, 64);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function objectsCount(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(999, Math.floor(numberValue)));
}

export function normalizeCrmContactInput(input: CrmContactInput): NormalizedCrmContactInput {
  return {
    name: text(input.name, 160),
    phone: text(input.phone, 80),
    telegramUsername: text(input.telegramUsername, 80).replace(/^@+/, ''),
    email: optionalEmail(input.email),
    role: enumValue(input.role, CRM_ROLE_VALUES, 'unknown'),
    source: enumValue(input.source, CRM_SOURCE_VALUES, 'manual'),
    objectsCount: objectsCount(input.objectsCount),
    city: text(input.city, 120),
    note: text(input.note, 2000),
    status: normalizePilotRolloutStorageStatus(enumValue(input.status, CRM_STATUS_VALUES, 'new')),
    communicationStatus: enumValue(input.communicationStatus, CRM_COMMUNICATION_STATUS_VALUES, 'no_contact'),
    lastContactAt: dateValue(input.lastContactAt),
    nextStep: text(input.nextStep, 500),
    nextActionAt: dateValue(input.nextActionAt),
  };
}

export function validateCrmContact(input: NormalizedCrmContactInput): string | null {
  if (!input.name) return 'Укажите имя контакта.';
  if (!input.phone && !input.telegramUsername && !input.email) {
    return 'Укажите хотя бы один способ связи.';
  }
  return null;
}
