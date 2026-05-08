import type { CommunicationChannel } from '@/lib/communication/types';

export type OperationsSourceChannel = CommunicationChannel | 'direct' | 'manual' | 'demo';

export type OperationsWorkflowStage =
  | 'new_inquiry'
  | 'booking_intake'
  | 'pre_checkin'
  | 'checkin'
  | 'in_stay'
  | 'checkout'
  | 'review_followup'
  | 'needs_operator';

export type OperationsChecklistStage =
  | 'pre_checkin'
  | 'checkin'
  | 'in_stay'
  | 'checkout'
  | 'review_followup';

export type OperationsAutomationMode = 'manual' | 'semi_auto' | 'full_auto';

export type OperationsChecklistStatus = 'pending' | 'done' | 'blocked' | 'not_applicable';

export type OperationsIssueType =
  | 'booking_context'
  | 'guest_support'
  | 'property_context'
  | 'payment_review'
  | 'maintenance_review'
  | 'communication'
  | 'other';

export type OperationsIssueUrgency = 'normal' | 'urgent';

export type OperationsIssueStatus = 'open' | 'in_progress' | 'resolved';

export type OperationsItemIssueStatus = 'none' | OperationsIssueStatus;

export type OperationsEscalationStatus = 'none' | 'pending_operator' | 'in_review' | 'resolved';

export type OperationsAuditEventType =
  | 'item_created'
  | 'stage_changed'
  | 'checklist_item_completed'
  | 'issue_created'
  | 'escalated'
  | 'note_added'
  | 'checked_in'
  | 'checked_out'
  | 'issue_resolved'
  | 'checkin_ready';

export interface OperationsGuestContact {
  name: string;
  email?: string;
  phone?: string;
  channel: OperationsSourceChannel;
  externalContactId?: string;
}

export interface OperationsBookingDates {
  checkIn?: string;
  checkOut?: string;
  nights?: number;
}

export interface OperationsChecklistItem {
  id: string;
  label: string;
  status: OperationsChecklistStatus;
  note?: string;
  completedAt?: string;
}

export interface OperationsChecklistSet {
  preCheckIn: OperationsChecklistItem[];
  checkIn: OperationsChecklistItem[];
  inStay: OperationsChecklistItem[];
  checkout: OperationsChecklistItem[];
  reviewFollowup: OperationsChecklistItem[];
}

export interface OperationsNote {
  id: string;
  body: string;
  createdAt: string;
  author?: string;
}

export interface OperationsAuditEvent {
  id: string;
  type: OperationsAuditEventType;
  label: string;
  detail?: string;
  createdAt: string;
  tone?: 'normal' | 'warn' | 'success';
}

export interface OperationsIssue {
  id: string;
  operationItemId: string;
  title: string;
  type: OperationsIssueType;
  urgency: OperationsIssueUrgency;
  status: OperationsIssueStatus;
  communicationReviewId?: string;
  notes: OperationsNote[];
  auditEvents: OperationsAuditEvent[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface OperationsItem {
  id: string;
  guest: OperationsGuestContact;
  sourceChannel: OperationsSourceChannel;
  propertyId?: string;
  objectId?: string;
  objectLabel: string;
  bookingDates: OperationsBookingDates;
  stage: OperationsWorkflowStage;
  automationMode: OperationsAutomationMode;
  checklists: OperationsChecklistSet;
  issueStatus: OperationsItemIssueStatus;
  escalationStatus: OperationsEscalationStatus;
  notes: OperationsNote[];
  auditEvents: OperationsAuditEvent[];
  communicationReviewId?: string;
  communicationSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export type OperationItem = OperationsItem;

export interface OperationsState {
  items: OperationsItem[];
  issues: OperationsIssue[];
  storageMode: 'seed' | 'local_storage';
  updatedAt: string;
}

