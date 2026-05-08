import type { CommunicationChannel } from '@/lib/communication/types';

export type OperationsWorkflowStage =
  | 'new_inquiry'
  | 'booking_intake'
  | 'pre_checkin'
  | 'checkin_today'
  | 'in_stay'
  | 'checkout'
  | 'review_followup'
  | 'needs_operator';

export type OperationsBookingStatus =
  | 'lead'
  | 'intake'
  | 'confirmed'
  | 'pre_checkin'
  | 'checked_in'
  | 'in_stay'
  | 'checked_out'
  | 'followup'
  | 'needs_operator'
  | 'closed';

export type OperationsPaymentStatus =
  | 'not_required'
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'needs_review';

export type OperationsCheckInStatus =
  | 'not_started'
  | 'requires_property_context'
  | 'ready'
  | 'guest_checked_in'
  | 'blocked'
  | 'operator_review';

export type OperationsCheckoutStatus =
  | 'not_started'
  | 'scheduled'
  | 'guest_checked_out'
  | 'turnover_pending'
  | 'completed'
  | 'issue_found';

export type OperationsIssueStatus =
  | 'none'
  | 'open'
  | 'urgent'
  | 'escalated'
  | 'closed';

export type OperationsAutomationMode = 'manual' | 'semi_automated' | 'fully_automated';

export interface OperationsGuestContact {
  guestName: string;
  email?: string;
  phone?: string;
  channel: CommunicationChannel | 'direct' | 'demo';
  externalContactId?: string;
}

export interface OperationsBookingDates {
  checkIn: string;
  checkOut: string;
  nights: number;
}

export interface OperationsChecklistItem {
  id: string;
  label: string;
  status: 'done' | 'pending' | 'blocked' | 'not_applicable';
  note?: string;
}

export interface OperationsTimelineEvent {
  id: string;
  label: string;
  detail?: string;
  createdAt: string;
  tone?: 'normal' | 'warn' | 'success';
}

export interface OperationsBookingIntake {
  id: string;
  guest: OperationsGuestContact;
  source: CommunicationChannel | 'direct' | 'demo';
  propertyId?: string;
  objectLabel: string;
  dates: OperationsBookingDates;
  stage: OperationsWorkflowStage;
  status: OperationsBookingStatus;
  paymentStatus: OperationsPaymentStatus;
  checkInStatus: OperationsCheckInStatus;
  checkoutStatus: OperationsCheckoutStatus;
  issueStatus: OperationsIssueStatus;
  automationMode: OperationsAutomationMode;
  notes: string[];
  checklist: OperationsChecklistItem[];
  communicationReviewId?: string;
  communicationSessionId?: string;
  createdAt: string;
  updatedAt: string;
  timeline: OperationsTimelineEvent[];
}
