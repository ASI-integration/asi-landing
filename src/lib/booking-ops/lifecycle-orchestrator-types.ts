export const BOOKING_LIFECYCLE_ORCHESTRATOR_STAGES = [
  'booking_received', 'guest_intake', 'legal_preparation', 'physical_preparation',
  'final_readiness_review', 'checkin_release_ready', 'checkin_release_draft_prepared',
  'in_stay', 'checkout_pending', 'completed', 'cancelled', 'blocked',
] as const;

export const BOOKING_LIFECYCLE_ORCHESTRATOR_STATUSES = [
  'not_started', 'active', 'waiting_guest', 'waiting_operator', 'waiting_worker',
  'ready_for_review', 'blocked', 'overdue', 'completed', 'cancelled',
] as const;

export type BookingLifecycleOrchestratorStage = (typeof BOOKING_LIFECYCLE_ORCHESTRATOR_STAGES)[number];
export type BookingLifecycleOrchestratorStatus = (typeof BOOKING_LIFECYCLE_ORCHESTRATOR_STATUSES)[number];
export type BookingLifecycleSeverity = 'info' | 'warning' | 'urgent' | 'critical';
export type BookingLifecycleSlaStatus = 'on_track' | 'warning' | 'overdue' | 'satisfied' | 'cancelled';

export type BookingLifecycleSlaItem = {
  id?: string;
  bookingId: string;
  propertyId: string | null;
  stage: BookingLifecycleOrchestratorStage;
  itemType: 'guest_intake' | 'legal_readiness' | 'cleaning' | 'linen' | 'maintenance' | 'final_readiness';
  status: 'pending' | 'satisfied' | 'overdue' | 'escalated' | 'cancelled' | 'waived';
  dueAt: string;
  completedAt: string | null;
  overdueSince: string | null;
  overdue: boolean;
  severity: BookingLifecycleSeverity;
  blockerReason: string | null;
  recommendedAction: string | null;
  escalationNeeded: boolean;
};

export type BookingLifecyclePlanInput = {
  bookingId: string;
  propertyId: string | null;
  createdAt: string;
  checkInAt: string | null;
  now: string;
  cancelled?: boolean;
  guestComplete: boolean;
  guestBlockers: string[];
  legalComplete: boolean;
  legalBlockers: string[];
  physicalReady: boolean;
  physicalBlockers: string[];
  cleaningVerified: boolean;
  linenVerified: boolean;
  blockingMaintenanceOpen: boolean;
  finalDraftPrepared: boolean;
};

export type BookingLifecyclePlan = {
  currentStage: BookingLifecycleOrchestratorStage;
  status: BookingLifecycleOrchestratorStatus;
  blockers: string[];
  nextAction: string | null;
  nextActionDueAt: string | null;
  slaStatus: BookingLifecycleSlaStatus;
  severity: BookingLifecycleSeverity;
  finalCheckinDraftAllowed: boolean;
  slaItems: BookingLifecycleSlaItem[];
};

export type BookingLifecycleOrchestratorSnapshot = {
  state: {
    bookingId: string;
    propertyId: string | null;
    currentStage: BookingLifecycleOrchestratorStage;
    status: BookingLifecycleOrchestratorStatus;
    blockers: string[];
    nextAction: string | null;
    nextActionDueAt: string | null;
    slaStatus: BookingLifecycleSlaStatus;
    severity: BookingLifecycleSeverity;
    lastOrchestratedAt: string;
    finalCheckinDraftAllowed: boolean;
    finalCheckinDraftId: string | null;
    updatedAt: string;
  };
  slaItems: BookingLifecycleSlaItem[];
  events: Array<{
    id: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    actorType: string;
    actorId: string | null;
    createdAt: string;
  }>;
  drafts: Array<{
    id: string;
    draftType: string;
    targetActor: string;
    status: string;
    createdAt: string;
  }>;
  lastRun: null | {
    id: string;
    runType: string;
    status: string;
    createdTasksCount: number;
    createdDraftsCount: number;
    createdEscalationsCount: number;
    startedAt: string;
    finishedAt: string | null;
  };
};
