import { optionalNullableString, optionalString } from './api';
import type {
  CreateOpsIncidentInput,
  CreateOpsPropertyTaskInput,
  CreatePropertyInput,
  CreatePropertyMediaInput,
  CreateReservationInput,
  MasterCardPublicationStatus,
  OpsIncidentSeverity,
  OpsIncidentSource,
  OpsIncidentStatus,
  OpsPropertyTaskCategory,
  OpsPropertyTaskPriority,
  OpsPropertyTaskSource,
  OpsPropertyTaskStatus,
  PropertyMediaStatus,
  PropertyStatus,
  ReservationDepositStatus,
  ReservationPaymentStatus,
  ReservationSourceChannel,
  ReservationStatus,
  UpdateMasterCardInput,
  UpdateOpsIncidentInput,
  UpdateOpsPropertyTaskInput,
  UpdatePropertyInput,
  UpdatePropertyMediaInput,
  UpdateReservationInput,
} from './types';

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === 'string');
}

export function parseCreatePropertyInput(body: Record<string, unknown>): CreatePropertyInput | null {
  const title = optionalString(body.title);
  if (!title) return null;
  return {
    title,
    address: optionalString(body.address),
    city: optionalString(body.city),
    timezone: optionalString(body.timezone),
    status: optionalString(body.status) as PropertyStatus | undefined,
  };
}

export function parseUpdatePropertyInput(body: Record<string, unknown>): UpdatePropertyInput {
  return {
    title: optionalString(body.title),
    address: optionalNullableString(body.address),
    city: optionalNullableString(body.city),
    timezone: optionalNullableString(body.timezone),
    status: optionalString(body.status) as PropertyStatus | undefined,
  };
}

export function parseUpdateMasterCardInput(body: Record<string, unknown>): UpdateMasterCardInput {
  return {
    publicTitle: optionalNullableString(body.publicTitle),
    shortDescription: optionalNullableString(body.shortDescription),
    fullDescription: optionalNullableString(body.fullDescription),
    amenities: stringArray(body.amenities),
    houseRules: optionalNullableString(body.houseRules),
    checkInInstructions: optionalNullableString(body.checkInInstructions),
    checkOutInstructions: optionalNullableString(body.checkOutInstructions),
    wifiName: optionalNullableString(body.wifiName),
    wifiPassword: optionalNullableString(body.wifiPassword),
    parkingInfo: optionalNullableString(body.parkingInfo),
    depositInfo: optionalNullableString(body.depositInfo),
    extraFeesInfo: optionalNullableString(body.extraFeesInfo),
    cancellationInfo: optionalNullableString(body.cancellationInfo),
    guestContactsInfo: optionalNullableString(body.guestContactsInfo),
    internalNotes: optionalNullableString(body.internalNotes),
    publicationStatus: optionalString(body.publicationStatus) as MasterCardPublicationStatus | undefined,
  };
}

export function parseCreateMediaInput(body: Record<string, unknown>): CreatePropertyMediaInput | null {
  const url = optionalString(body.url);
  const storagePath = optionalString(body.storagePath);
  if (!url && !storagePath) return null;
  return {
    url,
    storagePath,
    title: optionalString(body.title),
    description: optionalString(body.description),
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    isCover: typeof body.isCover === 'boolean' ? body.isCover : undefined,
    status: optionalString(body.status) as PropertyMediaStatus | undefined,
  };
}

export function parseUpdateMediaInput(body: Record<string, unknown>): UpdatePropertyMediaInput {
  return {
    url: optionalNullableString(body.url),
    storagePath: optionalNullableString(body.storagePath),
    title: optionalNullableString(body.title),
    description: optionalNullableString(body.description),
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    isCover: typeof body.isCover === 'boolean' ? body.isCover : undefined,
    status: optionalString(body.status) as PropertyMediaStatus | undefined,
  };
}

export function parseCreateReservationInput(body: Record<string, unknown>): CreateReservationInput | null {
  const propertyId = optionalString(body.propertyId);
  const guestName = optionalString(body.guestName);
  const checkInDate = optionalString(body.checkInDate);
  const checkOutDate = optionalString(body.checkOutDate);
  if (!propertyId || !guestName || !checkInDate || !checkOutDate) return null;
  return {
    propertyId,
    guestName,
    guestPhone: optionalString(body.guestPhone),
    guestEmail: optionalString(body.guestEmail),
    sourceChannel: optionalString(body.sourceChannel) as ReservationSourceChannel | undefined,
    externalReservationId: optionalString(body.externalReservationId),
    checkInDate,
    checkOutDate,
    status: optionalString(body.status) as ReservationStatus | undefined,
    paymentStatus: optionalString(body.paymentStatus) as ReservationPaymentStatus | undefined,
    depositStatus: optionalString(body.depositStatus) as ReservationDepositStatus | undefined,
    notes: optionalString(body.notes),
  };
}

export function parseUpdateReservationInput(body: Record<string, unknown>): UpdateReservationInput {
  return {
    guestName: optionalString(body.guestName),
    guestPhone: optionalNullableString(body.guestPhone),
    guestEmail: optionalNullableString(body.guestEmail),
    sourceChannel: optionalString(body.sourceChannel) as ReservationSourceChannel | undefined,
    externalReservationId: optionalNullableString(body.externalReservationId),
    checkInDate: optionalString(body.checkInDate),
    checkOutDate: optionalString(body.checkOutDate),
    status: optionalString(body.status) as ReservationStatus | undefined,
    paymentStatus: optionalString(body.paymentStatus) as ReservationPaymentStatus | undefined,
    depositStatus: optionalString(body.depositStatus) as ReservationDepositStatus | undefined,
    notes: optionalNullableString(body.notes),
  };
}

export function parseCreateTaskInput(body: Record<string, unknown>): CreateOpsPropertyTaskInput | null {
  const propertyId = optionalString(body.propertyId);
  const title = optionalString(body.title);
  if (!propertyId || !title) return null;
  return {
    propertyId,
    reservationId: optionalNullableString(body.reservationId) ?? undefined,
    title,
    description: optionalString(body.description),
    category: optionalString(body.category) as OpsPropertyTaskCategory | undefined,
    priority: optionalString(body.priority) as OpsPropertyTaskPriority | undefined,
    status: optionalString(body.status) as OpsPropertyTaskStatus | undefined,
    dueAt: optionalNullableString(body.dueAt) ?? undefined,
    assignedTo: optionalNullableString(body.assignedTo) ?? undefined,
    source: optionalString(body.source) as OpsPropertyTaskSource | undefined,
    escalationSource: optionalNullableString(body.escalationSource) ?? undefined,
  };
}

export function parseUpdateTaskInput(body: Record<string, unknown>): UpdateOpsPropertyTaskInput {
  return {
    reservationId: optionalNullableString(body.reservationId),
    title: optionalString(body.title),
    description: optionalNullableString(body.description),
    category: optionalString(body.category) as OpsPropertyTaskCategory | undefined,
    priority: optionalString(body.priority) as OpsPropertyTaskPriority | undefined,
    status: optionalString(body.status) as OpsPropertyTaskStatus | undefined,
    dueAt: optionalNullableString(body.dueAt),
    assignedTo: optionalNullableString(body.assignedTo),
    escalationSource: optionalNullableString(body.escalationSource),
  };
}

export function parseCreateIncidentInput(body: Record<string, unknown>): CreateOpsIncidentInput | null {
  const propertyId = optionalString(body.propertyId);
  const title = optionalString(body.title);
  if (!propertyId || !title) return null;
  return {
    propertyId,
    reservationId: optionalNullableString(body.reservationId) ?? undefined,
    title,
    description: optionalString(body.description),
    severity: optionalString(body.severity) as OpsIncidentSeverity | undefined,
    status: optionalString(body.status) as OpsIncidentStatus | undefined,
    source: optionalString(body.source) as OpsIncidentSource | undefined,
    escalationRequired: typeof body.escalationRequired === 'boolean' ? body.escalationRequired : undefined,
    escalationSource: optionalNullableString(body.escalationSource) ?? undefined,
  };
}

export function parseUpdateIncidentInput(body: Record<string, unknown>): UpdateOpsIncidentInput {
  return {
    reservationId: optionalNullableString(body.reservationId),
    title: optionalString(body.title),
    description: optionalNullableString(body.description),
    severity: optionalString(body.severity) as OpsIncidentSeverity | undefined,
    status: optionalString(body.status) as OpsIncidentStatus | undefined,
    source: optionalString(body.source) as OpsIncidentSource | undefined,
    escalationRequired: typeof body.escalationRequired === 'boolean' ? body.escalationRequired : undefined,
    escalationSource: optionalNullableString(body.escalationSource),
  };
}
