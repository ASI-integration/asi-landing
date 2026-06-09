/** OPS v1 foundation — доменные типы. */

export type PropertyStatus = 'draft' | 'active' | 'paused' | 'archived' | 'inactive';

export type MasterCardPublicationStatus = 'draft' | 'ready' | 'needs_review' | 'published';

export type PropertyMediaStatus = 'active' | 'hidden' | 'deleted';

export type ReservationSourceChannel =
  | 'direct'
  | 'ostrovok'
  | 'yandex_travel'
  | 'avito'
  | 'sutochno'
  | 'cian'
  | 'other';

export type ReservationStatus =
  | 'new'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show';

export type ReservationPaymentStatus = 'unknown' | 'unpaid' | 'partial' | 'paid' | 'refunded';

export type ReservationDepositStatus =
  | 'not_required'
  | 'pending'
  | 'received'
  | 'returned'
  | 'withheld';

export type OpsPropertyTaskCategory =
  | 'cleaning'
  | 'check_in'
  | 'check_out'
  | 'maintenance'
  | 'guest_request'
  | 'payment'
  | 'documents'
  | 'lock'
  | 'internet'
  | 'other';

export type OpsPropertyTaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export type OpsPropertyTaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export type OpsPropertyTaskSource = 'manual' | 'bot' | 'system';

export type OpsIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type OpsIncidentStatus = 'open' | 'investigating' | 'resolved' | 'closed';

export type OpsIncidentSource = 'manual' | 'bot' | 'guest' | 'system';

export interface OpsProperty {
  id: string;
  accountId: string;
  title: string;
  address: string | null;
  city: string | null;
  timezone: string | null;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyMasterCard {
  id: string;
  propertyId: string;
  publicTitle: string | null;
  shortDescription: string | null;
  fullDescription: string | null;
  amenities: string[];
  houseRules: string | null;
  checkInInstructions: string | null;
  checkOutInstructions: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  parkingInfo: string | null;
  depositInfo: string | null;
  extraFeesInfo: string | null;
  cancellationInfo: string | null;
  guestContactsInfo: string | null;
  internalNotes: string | null;
  contentVersion: number;
  publicationStatus: MasterCardPublicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PropertyMedia {
  id: string;
  propertyId: string;
  url: string | null;
  storagePath: string | null;
  title: string | null;
  description: string | null;
  sortOrder: number;
  isCover: boolean;
  status: PropertyMediaStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OpsReservation {
  id: string;
  propertyId: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  sourceChannel: ReservationSourceChannel;
  externalReservationId: string | null;
  checkInDate: string;
  checkOutDate: string;
  status: ReservationStatus;
  paymentStatus: ReservationPaymentStatus;
  depositStatus: ReservationDepositStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsPropertyTask {
  id: string;
  propertyId: string;
  reservationId: string | null;
  title: string;
  description: string | null;
  category: OpsPropertyTaskCategory;
  priority: OpsPropertyTaskPriority;
  status: OpsPropertyTaskStatus;
  dueAt: string | null;
  assignedTo: string | null;
  source: OpsPropertyTaskSource;
  escalationSource: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsIncident {
  id: string;
  propertyId: string;
  reservationId: string | null;
  title: string;
  description: string | null;
  severity: OpsIncidentSeverity;
  status: OpsIncidentStatus;
  source: OpsIncidentSource;
  escalationRequired: boolean;
  escalationSource: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsFoundationContext {
  accountId: string;
  userId?: string;
}

export interface CreatePropertyInput {
  title: string;
  address?: string;
  city?: string;
  timezone?: string;
  status?: PropertyStatus;
}

export interface UpdatePropertyInput {
  title?: string;
  address?: string | null;
  city?: string | null;
  timezone?: string | null;
  status?: PropertyStatus;
}

export interface UpdateMasterCardInput {
  publicTitle?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  amenities?: string[];
  houseRules?: string | null;
  checkInInstructions?: string | null;
  checkOutInstructions?: string | null;
  wifiName?: string | null;
  wifiPassword?: string | null;
  parkingInfo?: string | null;
  depositInfo?: string | null;
  extraFeesInfo?: string | null;
  cancellationInfo?: string | null;
  guestContactsInfo?: string | null;
  internalNotes?: string | null;
  publicationStatus?: MasterCardPublicationStatus;
}

export interface CreatePropertyMediaInput {
  url?: string;
  storagePath?: string;
  title?: string;
  description?: string;
  sortOrder?: number;
  isCover?: boolean;
  status?: PropertyMediaStatus;
}

export interface UpdatePropertyMediaInput {
  url?: string | null;
  storagePath?: string | null;
  title?: string | null;
  description?: string | null;
  sortOrder?: number;
  isCover?: boolean;
  status?: PropertyMediaStatus;
}

export interface CreateReservationInput {
  propertyId: string;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  sourceChannel?: ReservationSourceChannel;
  externalReservationId?: string;
  checkInDate: string;
  checkOutDate: string;
  status?: ReservationStatus;
  paymentStatus?: ReservationPaymentStatus;
  depositStatus?: ReservationDepositStatus;
  notes?: string;
}

export interface UpdateReservationInput {
  guestName?: string;
  guestPhone?: string | null;
  guestEmail?: string | null;
  sourceChannel?: ReservationSourceChannel;
  externalReservationId?: string | null;
  checkInDate?: string;
  checkOutDate?: string;
  status?: ReservationStatus;
  paymentStatus?: ReservationPaymentStatus;
  depositStatus?: ReservationDepositStatus;
  notes?: string | null;
}

export interface CreateOpsPropertyTaskInput {
  propertyId: string;
  reservationId?: string | null;
  title: string;
  description?: string;
  category?: OpsPropertyTaskCategory;
  priority?: OpsPropertyTaskPriority;
  status?: OpsPropertyTaskStatus;
  dueAt?: string | null;
  assignedTo?: string | null;
  source?: OpsPropertyTaskSource;
  escalationSource?: string | null;
}

export interface UpdateOpsPropertyTaskInput {
  reservationId?: string | null;
  title?: string;
  description?: string | null;
  category?: OpsPropertyTaskCategory;
  priority?: OpsPropertyTaskPriority;
  status?: OpsPropertyTaskStatus;
  dueAt?: string | null;
  assignedTo?: string | null;
  escalationSource?: string | null;
}

export interface CreateOpsIncidentInput {
  propertyId: string;
  reservationId?: string | null;
  title: string;
  description?: string;
  severity?: OpsIncidentSeverity;
  status?: OpsIncidentStatus;
  source?: OpsIncidentSource;
  escalationRequired?: boolean;
  escalationSource?: string | null;
}

export interface UpdateOpsIncidentInput {
  reservationId?: string | null;
  title?: string;
  description?: string | null;
  severity?: OpsIncidentSeverity;
  status?: OpsIncidentStatus;
  source?: OpsIncidentSource;
  escalationRequired?: boolean;
  escalationSource?: string | null;
}
