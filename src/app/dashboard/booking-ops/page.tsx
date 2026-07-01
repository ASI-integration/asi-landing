'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
import { ObjectSetupReadinessPanel } from '@/components/booking-ops/ObjectSetupReadinessPanel';
import { ChannelManagerImportPanel } from '@/components/booking-ops/ChannelManagerImportPanel';
import { readResponseJson } from '@/lib/safeResponseJson';
import {
  BOOKING_OPS_CHECKIN_READINESS_STATUS_LABELS_RU,
  BOOKING_OPS_CHECKIN_READINESS_STATUSES,
  BOOKING_OPS_CONTRACT_INTAKE_STATUS_LABELS_RU,
  BOOKING_OPS_CONTRACT_INTAKE_STATUSES,
  BOOKING_OPS_CONTRACT_PROVIDER_LABELS_RU,
  BOOKING_OPS_CONTRACT_PROVIDERS,
  BOOKING_OPS_CONTRACT_STATUS_LABELS_RU,
  BOOKING_OPS_CONTRACT_STATUSES,
  BOOKING_OPS_DEPOSIT_INTAKE_STATUS_LABELS_RU,
  BOOKING_OPS_DEPOSIT_INTAKE_STATUSES,
  BOOKING_OPS_DEPOSIT_STATUS_LABELS_RU,
  BOOKING_OPS_DEPOSIT_STATUSES,
  BOOKING_OPS_DOCUMENT_VERIFICATION_STATUS_LABELS_RU,
  BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES,
  BOOKING_OPS_DOCUMENTS_STATUS_LABELS_RU,
  BOOKING_OPS_DOCUMENTS_STATUSES,
  BOOKING_OPS_MVD_DATA_STATUS_LABELS_RU,
  BOOKING_OPS_MVD_DATA_STATUSES,
  BOOKING_OPS_MVD_STATUS_LABELS_RU,
  BOOKING_OPS_MVD_STATUSES,
  BOOKING_OPS_NEXT_ACTION_LABELS_RU,
  BOOKING_OPS_STATUS_LABELS_RU,
  BOOKING_OPS_STATUSES,
  BOOKING_OPS_UNIT_READINESS_STATUS_LABELS_RU,
  BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS,
  BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU,
  BOOKING_OPS_COMMUNICATION_ACTOR_LABELS_RU,
  BOOKING_OPS_COMMUNICATION_STATUS_LABELS_RU,
  BOOKING_OPS_GUEST_INTAKE_STATUS_LABELS_RU,
  type BookingOpsCheckinReadinessStatus,
  type BookingOpsContractIntakeStatus,
  type BookingOpsContractProvider,
  type BookingOpsContractStatus,
  type BookingOpsDepositIntakeStatus,
  type BookingOpsDepositStatus,
  type BookingOpsDocumentVerificationStatus,
  type BookingOpsDocumentsStatus,
  type BookingOpsMvdDataStatus,
  type BookingOpsMvdStatus,
  type BookingOpsRecord,
  type BookingOpsStatus,
  type BookingOpsAlertSeverity,
  type BookingOpsActionTemplate,
  type BookingOpsTelegramDraft,
  type BookingOpsCommunicationIntent,
  type BookingOpsGuestIntakeSession,
} from '@/lib/booking-ops/types';
import { GUEST_INTAKE_FIELD_LABELS_RU } from '@/lib/booking-ops/guest-intake-state';
import {
  BOOKING_OPS_TASK_STATUS_LABELS_RU,
  BOOKING_OPS_TASK_STATUSES,
  BOOKING_OPS_TASK_ACTION_LABELS_RU,
  BOOKING_OPS_TASK_SOURCE_LABELS_RU,
  type BookingOpsTask,
  type BookingOpsTaskStatus,
} from '@/lib/booking-ops/task-types';
import {
  BOOKING_READINESS_STATUS_LABELS_RU,
  type BookingReadinessStatus,
} from '@/lib/booking-ops/readiness';
import type { BookingOpsTaskCompletionEffectResult } from '@/lib/booking-ops/task-completion-effects';
import type { BookingOpsEvent } from '@/lib/booking-ops/events';
import {
  getBookingOpsOperatorGuidance,
  type BookingOpsOperatorGuidance,
} from '@/lib/booking-ops/operator-guidance';
import {
  computeUnitReadinessStatus,
  isTurnoverTaskType,
} from '@/lib/booking-ops/turnover';
import { planBookingOpsPreparation } from '@/lib/booking-ops/automation-engine';
import {
  formatBookingOpsGuestNameDisplay,
  formatBookingOpsMessageTextDisplay,
  formatBookingOpsOtaSourceDisplay,
  formatBookingOpsPropertyLabelDisplay,
  resolveBookingOpsEditDraftSaveValue,
  toBookingOpsEditDraftDisplayValue,
} from '@/lib/booking-ops/display-labels';
import {
  BOOKING_LIFECYCLE_GATE_LABELS_RU,
  BOOKING_LIFECYCLE_STATUS_LABELS_RU,
  type BookingLifecycleGate,
  type BookingLifecycleGateKey,
  type BookingLifecycleSnapshot,
  type BookingLifecycleStatus,
} from '@/lib/booking-ops/lifecycle-types';
import type { LegalPaymentStatus } from '@/lib/booking-ops/legal-payment-autopilot';
import type {
  PreCheckinReadinessSnapshot,
  PreCheckinReadinessStatus,
} from '@/lib/booking-ops/pre-checkin-control-center';
import type {
  CheckinExecutionSnapshot,
  CheckinExecutionStatus,
} from '@/lib/booking-ops/checkin-execution-autopilot';
import type {
  InStayCheckoutSnapshot,
  InStayCheckoutStatus,
} from '@/lib/booking-ops/instay-checkout-autopilot';

type ListResponse = {
  ok: boolean;
  message?: string;
  records: BookingOpsRecord[];
  isOpsAdmin?: boolean;
  refreshedAt?: string;
};

type IntakeEventRow = {
  id: string;
  source: string;
  status: string;
  bookingId: string | null;
  guestContactStatus: string;
  propertyStatus: string;
  datesStatus: string;
  missingFields: string[];
  nextAction: string | null;
  duplicateOfBookingId: string | null;
  automationResult: Record<string, unknown>;
  createdAt: string;
  safeSummary?: string;
};

type IntakeEventsResponse = {
  ok: boolean;
  message?: string;
  events?: IntakeEventRow[];
};

type SaveResponse = {
  ok: boolean;
  message?: string;
  record?: BookingOpsRecord;
};

type TelegramDraftResponse = {
  ok: boolean;
  message?: string;
  draft?: BookingOpsTelegramDraft;
  drafts?: BookingOpsTelegramDraft[];
};

type TasksResponse = {
  ok: boolean;
  message?: string;
  tasks?: BookingOpsTask[];
  task?: BookingOpsTask;
};

type RecomputeResponse = TasksResponse & {
  record?: BookingOpsRecord;
  communications?: BookingOpsCommunicationIntent[];
  communicationNextAction?: string | null;
  guestIntake?: BookingOpsGuestIntakeSession | null;
};

type CommunicationsResponse = {
  ok: boolean;
  message?: string;
  communications?: BookingOpsCommunicationIntent[];
  nextAction?: string | null;
};

type CommunicationAutoSendAction =
  | 'run_dry_run'
  | 'send_now'
  | 'retry_failed'
  | 'approve_send'
  | 'force_review'
  | 'block_auto_send'
  | 'mark_safe_type'
  | 'disable_booking';

type TaskUpdateResponse = TasksResponse & {
  effectResult?: BookingOpsTaskCompletionEffectResult | null;
};

type TaskActionResult = {
  ok: boolean;
  actionType: string;
  message: string;
  createdDraftIds: string[] | null;
  checklist: string[] | null;
  nextTaskStatusSuggestion: BookingOpsTaskStatus | null;
  blockingReason: string | null;
};

type TaskRunResponse = {
  ok: boolean;
  message?: string;
  actionResult?: TaskActionResult;
};

type TimelineResponse = {
  ok: boolean;
  message?: string;
  events?: BookingOpsEvent[];
};

type LifecycleResponse = {
  ok: boolean;
  message?: string;
  lifecycle?: BookingLifecycleSnapshot;
};

type LegalPaymentAction =
  | 'initialize'
  | 'request_documents'
  | 'documents_received'
  | 'verify_documents'
  | 'reject_documents'
  | 'prepare_contract'
  | 'contract_sent'
  | 'contract_signed'
  | 'request_deposit'
  | 'deposit_received'
  | 'waive_deposit'
  | 'prepare_mvd_report'
  | 'mvd_report_submitted'
  | 'mvd_report_accepted';

type LegalPaymentResponse = {
  ok: boolean;
  message?: string;
  status?: LegalPaymentStatus;
};

type PreCheckinResponse = {
  ok: boolean;
  message?: string;
  readiness?: PreCheckinReadinessSnapshot;
};

type CheckinExecutionResponse = {
  ok: boolean;
  message?: string;
  checkin?: CheckinExecutionSnapshot;
};

type InStayCheckoutResponse = {
  ok: boolean;
  message?: string;
  instayCheckout?: InStayCheckoutSnapshot;
};

type PreCheckinAction =
  | 'recompute'
  | 'mark_ready_override'
  | 'clear_ready_override'
  | 'create_fallback'
  | 'resolve_fallback'
  | 'add_note'
  | 'block_gate'
  | 'skip_gate';

type CheckinExecutionAction =
  | 'prepare_instructions'
  | 'queue_instructions'
  | 'mark_instructions_sent'
  | 'request_arrival_confirmation'
  | 'mark_arrival_confirmed'
  | 'mark_access_ready'
  | 'report_access_issue'
  | 'resolve_access_issue'
  | 'mark_guest_checked_in'
  | 'create_fallback'
  | 'add_note';

type InStayCheckoutAction =
  | 'open_support_window'
  | 'create_guest_issue'
  | 'triage_guest_issue'
  | 'resolve_guest_issue'
  | 'prepare_checkout_instructions'
  | 'queue_checkout_instructions'
  | 'mark_checkout_instructions_sent'
  | 'request_checkout_confirmation'
  | 'mark_guest_checked_out'
  | 'trigger_post_checkout_inspection'
  | 'mark_post_checkout_inspection_done'
  | 'mark_deposit_return_ready'
  | 'mark_booking_closed'
  | 'create_fallback'
  | 'add_note';

const AUTOMATION_TONE: Record<string, string> = {
  action_required: 'border-amber-200 bg-amber-50 text-amber-900',
  waiting: 'border-sky-200 bg-sky-50 text-sky-900',
  needs_operator_attention: 'border-rose-200 bg-rose-50 text-rose-900',
  blocked: 'border-red-300 bg-red-50 text-red-900',
  manual_override: 'border-violet-200 bg-violet-50 text-violet-900',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  paused: 'border-slate-200 bg-slate-50 text-slate-700',
  automatic_action_available: 'border-indigo-200 bg-indigo-50 text-indigo-900',
};

const ALERT_SEVERITY_TONE: Record<BookingOpsAlertSeverity, string> = {
  critical: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
};

const ALERT_SEVERITY_LABEL: Record<BookingOpsAlertSeverity, string> = {
  critical: 'Срочно',
  warning: 'Внимание',
  info: 'Инфо',
};

const PRE_CHECKIN_TONE: Record<PreCheckinReadinessStatus, string> = {
  ready_for_checkin: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  needs_attention: 'border-amber-200 bg-amber-50 text-amber-950',
  blocked: 'border-red-200 bg-red-50 text-red-950',
  overdue: 'border-rose-300 bg-rose-50 text-rose-950',
  checked_in: 'border-sky-200 bg-sky-50 text-sky-950',
  closed: 'border-slate-200 bg-slate-50 text-slate-700',
};

const PRE_CHECKIN_READINESS_STATUS_LABELS_RU: Record<PreCheckinReadinessStatus, string> = {
  ready_for_checkin: 'Готово к заезду',
  needs_attention: 'Требует внимания',
  blocked: 'Заблокировано',
  overdue: 'Просрочено',
  checked_in: 'Заселён',
  closed: 'Закрыто',
};

const PRE_CHECKIN_ACTION_LABELS_RU: Record<PreCheckinAction, string> = {
  recompute: 'Пересчитать',
  mark_ready_override: 'Подтвердить готовность',
  clear_ready_override: 'Снять подтверждение',
  create_fallback: 'Создать ручной план',
  resolve_fallback: 'Закрыть ручной план',
  add_note: 'Добавить заметку',
  block_gate: 'Заблокировать этап',
  skip_gate: 'Пропустить этап',
};

const CHECKIN_EXECUTION_TONE: Record<CheckinExecutionStatus, string> = {
  not_ready: 'border-slate-200 bg-slate-50 text-slate-700',
  ready_to_send_instructions: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  instructions_queued: 'border-sky-200 bg-sky-50 text-sky-950',
  instructions_sent: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  arrival_pending: 'border-amber-200 bg-amber-50 text-amber-950',
  arrival_confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  access_ready: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  access_issue: 'border-red-200 bg-red-50 text-red-950',
  checked_in: 'border-slate-200 bg-white text-slate-800',
  blocked: 'border-red-200 bg-red-50 text-red-950',
};

const CHECKIN_EXECUTION_STATUS_LABELS_RU: Record<CheckinExecutionStatus, string> = {
  not_ready: 'Не готово',
  ready_to_send_instructions: 'Можно готовить инструкции',
  instructions_queued: 'Инструкции в очереди',
  instructions_sent: 'Инструкции отправлены',
  arrival_pending: 'Ждём подтверждение',
  arrival_confirmed: 'Прибытие подтверждено',
  access_ready: 'Доступ готов',
  access_issue: 'Проблема доступа',
  checked_in: 'Гость заехал',
  blocked: 'Заблокировано',
};

const CHECKIN_INSTRUCTIONS_STATUS_LABELS_RU = {
  not_prepared: 'Не подготовлены',
  prepared: 'Подготовлены',
  queued: 'В очереди',
  sent: 'Отправлены',
  failed: 'Ошибка',
} as const;

const CHECKIN_ARRIVAL_STATUS_LABELS_RU = {
  unknown: 'Неизвестно',
  requested: 'Запрошено',
  confirmed: 'Подтверждено',
  missed: 'Пропущено',
  changed: 'Изменено',
} as const;

const CHECKIN_ACCESS_STATUS_LABELS_RU = {
  unknown: 'Неизвестно',
  ready: 'Готов',
  issue: 'Проблема',
  resolved: 'Разобрано',
} as const;

const CHECKIN_EXECUTION_ACTION_LABELS_RU: Record<CheckinExecutionAction, string> = {
  prepare_instructions: 'Подготовить',
  queue_instructions: 'В очередь',
  mark_instructions_sent: 'Отправлено',
  request_arrival_confirmation: 'Запросить прибытие',
  mark_arrival_confirmed: 'Прибытие подтверждено',
  mark_access_ready: 'Доступ готов',
  report_access_issue: 'Проблема доступа',
  resolve_access_issue: 'Разобрать проблему',
  mark_guest_checked_in: 'Гость заехал',
  create_fallback: 'Открыть ручной план',
  add_note: 'Заметка',
};

const INSTAY_CHECKOUT_TONE: Record<InStayCheckoutStatus, string> = {
  not_checked_in: 'border-slate-200 bg-slate-50 text-slate-700',
  in_stay: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  guest_issue_open: 'border-amber-200 bg-amber-50 text-amber-950',
  guest_issue_blocked: 'border-red-200 bg-red-50 text-red-950',
  checkout_preparing: 'border-sky-200 bg-sky-50 text-sky-950',
  checkout_instructions_queued: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  checkout_pending: 'border-amber-200 bg-amber-50 text-amber-950',
  checked_out: 'border-slate-200 bg-white text-slate-800',
  inspection_pending: 'border-violet-200 bg-violet-50 text-violet-950',
  inspection_done: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  deposit_return_ready: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  ready_to_close: 'border-sky-200 bg-sky-50 text-sky-950',
  closed: 'border-slate-200 bg-slate-50 text-slate-700',
  blocked: 'border-red-200 bg-red-50 text-red-950',
};

const INSTAY_CHECKOUT_STATUS_LABELS_RU: Record<InStayCheckoutStatus, string> = {
  not_checked_in: 'Гость не заехал',
  in_stay: 'Проживание',
  guest_issue_open: 'Есть обращение',
  guest_issue_blocked: 'Проблема блокирует',
  checkout_preparing: 'Готовим выезд',
  checkout_instructions_queued: 'Инструкции в очереди',
  checkout_pending: 'Ждём выезд',
  checked_out: 'Гость выехал',
  inspection_pending: 'Осмотр',
  inspection_done: 'Осмотр готов',
  deposit_return_ready: 'Депозит готов',
  ready_to_close: 'Можно закрыть',
  closed: 'Закрыто',
  blocked: 'Заблокировано',
};

const INSTAY_CHECKOUT_INSTRUCTIONS_LABELS_RU = {
  not_prepared: 'Не подготовлены',
  prepared: 'Подготовлены',
  queued: 'В очереди',
  sent: 'Отправлены',
  failed: 'Ошибка',
} as const;

const INSTAY_CHECKOUT_CONFIRMATION_LABELS_RU = {
  not_requested: 'Не запрошено',
  requested: 'Запрошено',
  confirmed: 'Подтверждено',
  missed: 'Пропущено',
} as const;

const INSTAY_CHECKOUT_INSPECTION_LABELS_RU = {
  not_started: 'Не начат',
  scheduled: 'Назначен',
  done: 'Готов',
  issue_found: 'Есть проблема',
  failed: 'Ошибка',
} as const;

const INSTAY_CHECKOUT_DEPOSIT_LABELS_RU = {
  not_ready: 'Не готов',
  ready: 'Готов',
  held: 'Удержан',
  partially_held: 'Частично',
  returned: 'Возвращён',
  waived: 'Не требуется',
} as const;

const INSTAY_CHECKOUT_CLOSURE_LABELS_RU = {
  open: 'Открыта',
  ready_to_close: 'К закрытию',
  closed: 'Закрыта',
  blocked: 'Заблокирована',
} as const;

const INSTAY_CHECKOUT_ACTION_LABELS_RU: Record<InStayCheckoutAction, string> = {
  open_support_window: 'Открыть поддержку',
  create_guest_issue: 'Обращение гостя',
  triage_guest_issue: 'Разобрать',
  resolve_guest_issue: 'Закрыть обращение',
  prepare_checkout_instructions: 'Подготовить выезд',
  queue_checkout_instructions: 'В очередь',
  mark_checkout_instructions_sent: 'Инструкции отправлены',
  request_checkout_confirmation: 'Запросить выезд',
  mark_guest_checked_out: 'Гость выехал',
  trigger_post_checkout_inspection: 'Запустить осмотр',
  mark_post_checkout_inspection_done: 'Осмотр готов',
  mark_deposit_return_ready: 'Депозит готов',
  mark_booking_closed: 'Закрыть бронь',
  create_fallback: 'Открыть ручной план',
  add_note: 'Заметка',
};

function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

const READINESS_TONE: Record<BookingReadinessStatus, string> = {
  missing_booking_data: 'border-amber-200 bg-amber-50 text-amber-950',
  missing_documents: 'border-amber-200 bg-amber-50 text-amber-950',
  missing_contract: 'border-amber-200 bg-amber-50 text-amber-950',
  missing_deposit: 'border-amber-200 bg-amber-50 text-amber-950',
  missing_mvd_data: 'border-amber-200 bg-amber-50 text-amber-950',
  ready_for_drafts: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  drafts_created: 'border-sky-200 bg-sky-50 text-sky-950',
  ready_for_manual_send: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  completed: 'border-slate-200 bg-slate-50 text-slate-800',
};

type EditDraft = {
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  guestTelegram: string;
  propertyId: string;
  propertyLabel: string;
  otaSource: string;
  checkInAt: string;
  checkOutAt: string;
  guestCount: string;
  paymentStatus: string;
  opsStatus: BookingOpsStatus;
  documentsStatus: BookingOpsDocumentsStatus;
  contractStatus: BookingOpsContractStatus;
  depositStatus: BookingOpsDepositStatus;
  mvdStatus: BookingOpsMvdStatus;
  checkinReadinessStatus: BookingOpsCheckinReadinessStatus;
  documentRequired: '' | 'true' | 'false';
  documentCollected: '' | 'true' | 'false';
  documentVerificationStatus: '' | BookingOpsDocumentVerificationStatus;
  documentNotes: string;
  contractRequired: '' | 'true' | 'false';
  contractProvider: '' | BookingOpsContractProvider;
  contractIntakeStatus: '' | BookingOpsContractIntakeStatus;
  contractLink: string;
  contractNotes: string;
  depositRequired: '' | 'true' | 'false';
  depositAmount: string;
  depositIntakeStatus: '' | BookingOpsDepositIntakeStatus;
  depositPaymentMethod: string;
  depositNotes: string;
  mvdRequired: '' | 'true' | 'false';
  mvdDataStatus: '' | BookingOpsMvdDataStatus;
  mvdConfirmationLink: string;
  mvdNotes: string;
  isBlocked: boolean;
  blockerReason: string;
  manualNextAction: string;
  notes: string;
};

function triStateFromBoolean(value: boolean | null | undefined): '' | 'true' | 'false' {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

function booleanFromTriState(value: '' | 'true' | 'false'): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function draftFromRecord(record: BookingOpsRecord): EditDraft {
  return {
    guestName: toBookingOpsEditDraftDisplayValue('guestName', record.guestName),
    guestPhone: record.guestPhone ?? '',
    guestEmail: record.guestEmail ?? '',
    guestTelegram: record.guestTelegram ?? '',
    propertyId: record.propertyId ?? '',
    propertyLabel: toBookingOpsEditDraftDisplayValue(
      'propertyLabel',
      record.propertyLabel,
      record.propertyId,
    ),
    otaSource: toBookingOpsEditDraftDisplayValue('otaSource', record.otaSource),
    checkInAt: formatDateInput(record.checkInAt),
    checkOutAt: formatDateInput(record.checkOutAt),
    guestCount: record.guestCount != null ? String(record.guestCount) : '',
    paymentStatus: record.paymentStatus ?? '',
    opsStatus: record.opsStatus,
    documentsStatus: record.documentsStatus,
    contractStatus: record.contractStatus,
    depositStatus: record.depositStatus,
    mvdStatus: record.mvdStatus,
    checkinReadinessStatus: record.checkinReadinessStatus,
    documentRequired: triStateFromBoolean(record.documentRequired),
    documentCollected: triStateFromBoolean(record.documentCollected),
    documentVerificationStatus: record.documentVerificationStatus ?? '',
    documentNotes: record.documentNotes ?? '',
    contractRequired: triStateFromBoolean(record.contractRequired),
    contractProvider: record.contractProvider ?? '',
    contractIntakeStatus: record.contractIntakeStatus ?? '',
    contractLink: record.contractLink ?? '',
    contractNotes: record.contractNotes ?? '',
    depositRequired: triStateFromBoolean(record.depositRequired),
    depositAmount: record.depositAmount != null ? String(record.depositAmount) : '',
    depositIntakeStatus: record.depositIntakeStatus ?? '',
    depositPaymentMethod: record.depositPaymentMethod ?? '',
    depositNotes: record.depositNotes ?? '',
    mvdRequired: triStateFromBoolean(record.mvdRequired),
    mvdDataStatus: record.mvdDataStatus ?? '',
    mvdConfirmationLink: record.mvdConfirmationLink ?? '',
    mvdNotes: record.mvdNotes ?? '',
    isBlocked: record.isBlocked,
    blockerReason: record.blockerReason ?? '',
    manualNextAction: record.manualNextAction ?? '',
    notes: toBookingOpsEditDraftDisplayValue('notes', record.notes),
  };
}

function intakePayloadFromDraft(draft: EditDraft): Record<string, unknown> {
  return {
    guestCount: draft.guestCount ? Number(draft.guestCount) : null,
    paymentStatus: draft.paymentStatus || null,
    documentRequired: booleanFromTriState(draft.documentRequired),
    documentCollected: booleanFromTriState(draft.documentCollected),
    documentVerificationStatus: draft.documentVerificationStatus || null,
    documentNotes: draft.documentNotes || null,
    contractRequired: booleanFromTriState(draft.contractRequired),
    contractProvider: draft.contractProvider || null,
    contractIntakeStatus: draft.contractIntakeStatus || null,
    contractLink: draft.contractLink || null,
    contractNotes: draft.contractNotes || null,
    depositRequired: booleanFromTriState(draft.depositRequired),
    depositAmount: draft.depositAmount ? Number(draft.depositAmount) : null,
    depositIntakeStatus: draft.depositIntakeStatus || null,
    depositPaymentMethod: draft.depositPaymentMethod || null,
    depositNotes: draft.depositNotes || null,
    mvdRequired: booleanFromTriState(draft.mvdRequired),
    mvdDataStatus: draft.mvdDataStatus || null,
    mvdConfirmationLink: draft.mvdConfirmationLink || null,
    mvdNotes: draft.mvdNotes || null,
  };
}

function BookingOpsPageInner() {
  const [records, setRecords] = useState<BookingOpsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [isOpsAdmin, setIsOpsAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [telegramDrafts, setTelegramDrafts] = useState<BookingOpsTelegramDraft[]>([]);
  const [telegramDraftsLoading, setTelegramDraftsLoading] = useState(false);
  const [creatingTelegramDraft, setCreatingTelegramDraft] = useState(false);
  const [opsTasks, setOpsTasks] = useState<BookingOpsTask[]>([]);
  const [opsTasksLoading, setOpsTasksLoading] = useState(false);
  const [communications, setCommunications] = useState<BookingOpsCommunicationIntent[]>([]);
  const [communicationsLoading, setCommunicationsLoading] = useState(false);
  const [updatingCommunicationId, setUpdatingCommunicationId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<BookingOpsEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [lifecycle, setLifecycle] = useState<BookingLifecycleSnapshot | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [updatingLifecycleGate, setUpdatingLifecycleGate] = useState<string | null>(null);
  const [legalPayment, setLegalPayment] = useState<LegalPaymentStatus | null>(null);
  const [legalPaymentLoading, setLegalPaymentLoading] = useState(false);
  const [legalPaymentAction, setLegalPaymentAction] = useState<LegalPaymentAction | null>(null);
  const [preCheckin, setPreCheckin] = useState<PreCheckinReadinessSnapshot | null>(null);
  const [preCheckinLoading, setPreCheckinLoading] = useState(false);
  const [preCheckinAction, setPreCheckinAction] = useState<PreCheckinAction | null>(null);
  const [checkinExecution, setCheckinExecution] = useState<CheckinExecutionSnapshot | null>(null);
  const [checkinExecutionLoading, setCheckinExecutionLoading] = useState(false);
  const [checkinExecutionAction, setCheckinExecutionAction] = useState<CheckinExecutionAction | null>(null);
  const [instayCheckout, setInstayCheckout] = useState<InStayCheckoutSnapshot | null>(null);
  const [instayCheckoutLoading, setInstayCheckoutLoading] = useState(false);
  const [instayCheckoutAction, setInstayCheckoutAction] = useState<InStayCheckoutAction | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [recomputingPreparation, setRecomputingPreparation] = useState(false);
  const [taskActionResults, setTaskActionResults] = useState<Record<string, TaskActionResult>>({});
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [intakeEvents, setIntakeEvents] = useState<IntakeEventRow[]>([]);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeActionId, setIntakeActionId] = useState<string | null>(null);
  const [expandedIntakeId, setExpandedIntakeId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<EditDraft>({
    guestName: '',
    guestPhone: '',
    guestEmail: '',
    guestTelegram: '',
    propertyId: '',
    propertyLabel: '',
    otaSource: 'manual',
    checkInAt: '',
    checkOutAt: '',
    guestCount: '',
    paymentStatus: '',
    opsStatus: 'created',
    documentsStatus: 'not_started',
    contractStatus: 'not_started',
    depositStatus: 'not_started',
    mvdStatus: 'not_required',
    checkinReadinessStatus: 'not_started',
    documentRequired: '',
    documentCollected: '',
    documentVerificationStatus: '',
    documentNotes: '',
    contractRequired: '',
    contractProvider: '',
    contractIntakeStatus: '',
    contractLink: '',
    contractNotes: '',
    depositRequired: '',
    depositAmount: '',
    depositIntakeStatus: '',
    depositPaymentMethod: '',
    depositNotes: '',
    mvdRequired: '',
    mvdDataStatus: '',
    mvdConfirmationLink: '',
    mvdNotes: '',
    isBlocked: false,
    blockerReason: '',
    manualNextAction: '',
    notes: '',
  });

  const selectedRecord = useMemo(
    () => records.find((record) => record.id === selectedId) ?? null,
    [records, selectedId],
  );

  const operatorGuidance = useMemo(
    () => selectedRecord?.readiness
      ? getBookingOpsOperatorGuidance(
          selectedRecord,
          selectedRecord.readiness,
          opsTasks,
          timelineEvents,
          telegramDrafts,
        )
      : null,
    [selectedRecord, opsTasks, timelineEvents, telegramDrafts],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const [res, intakeRes] = await Promise.all([
        fetch('/api/dashboard/booking-ops', { credentials: 'include' }),
        fetch('/api/dashboard/booking-ops/intake/events?limit=20', { credentials: 'include' }),
      ]);
      const payload = await readResponseJson<ListResponse>(res, { ok: false, records: [] });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось загрузить операционные брони.');
        return;
      }
      setRecords(payload.records);
      setIsOpsAdmin(Boolean(payload.isOpsAdmin));
      if (selectedId) {
        const fresh = payload.records.find((record) => record.id === selectedId);
        if (fresh) setDraft(draftFromRecord(fresh));
      }
      if (intakeRes.ok) {
        const intakePayload = await readResponseJson<IntakeEventsResponse>(intakeRes, { ok: false, events: [] });
        if (intakePayload.ok && intakePayload.events) {
          setIntakeEvents(intakePayload.events);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId || records.length !== 1) return;
    selectRecord(records[0]);
  }, [records, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setTelegramDrafts([]);
      return;
    }

    let cancelled = false;
    setTelegramDraftsLoading(true);
    void fetch(`/api/dashboard/booking-ops/${selectedId}/telegram-drafts`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<TelegramDraftResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setMessage(payload.message || 'Не удалось загрузить черновики Telegram.');
          setTelegramDrafts([]);
          return;
        }
        setTelegramDrafts(payload.drafts ?? []);
      })
      .finally(() => {
        if (!cancelled) setTelegramDraftsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setTimelineEvents([]);
      return;
    }

    let cancelled = false;
    setTimelineLoading(true);
    void fetch(`/api/dashboard/booking-ops/${selectedId}/events`, { credentials: 'include' })
      .then(async (res) => {
        const payload = await readResponseJson<TimelineResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setTimelineEvents([]);
          return;
        }
        setTimelineEvents(payload.events ?? []);
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setOpsTasks([]);
      return;
    }

    let cancelled = false;
    setOpsTasksLoading(true);
    void fetch(`/api/dashboard/booking-ops/${selectedId}/tasks`, { credentials: 'include' })
      .then(async (res) => {
        const payload = await readResponseJson<TasksResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setOpsTasks([]);
          return;
        }
        setOpsTasks(payload.tasks ?? []);
      })
      .finally(() => {
        if (!cancelled) setOpsTasksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setCommunications([]);
      return;
    }

    let cancelled = false;
    setCommunicationsLoading(true);
    void fetch(`/api/dashboard/booking-ops/${selectedId}/communications`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<CommunicationsResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setCommunications([]);
          return;
        }
        setCommunications(payload.communications ?? []);
      })
      .finally(() => {
        if (!cancelled) setCommunicationsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setLifecycle(null);
      return;
    }

    let cancelled = false;
    setLifecycleLoading(true);
    void fetch(`/api/dashboard/booking-ops/${selectedId}/lifecycle`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<LifecycleResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setLifecycle(null);
          return;
        }
        setLifecycle(payload.lifecycle ?? null);
      })
      .finally(() => {
        if (!cancelled) setLifecycleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setLegalPayment(null);
      return;
    }

    let cancelled = false;
    setLegalPaymentLoading(true);
    void fetch(`/api/dashboard/booking-ops/legal-payment?bookingId=${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<LegalPaymentResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setLegalPayment(null);
          return;
        }
        setLegalPayment(payload.status ?? null);
      })
      .finally(() => {
        if (!cancelled) setLegalPaymentLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setPreCheckin(null);
      return;
    }

    let cancelled = false;
    setPreCheckinLoading(true);
    void fetch(`/api/dashboard/booking-ops/pre-checkin?bookingId=${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<PreCheckinResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setPreCheckin(null);
          return;
        }
        setPreCheckin(payload.readiness ?? null);
      })
      .finally(() => {
        if (!cancelled) setPreCheckinLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setCheckinExecution(null);
      return;
    }

    let cancelled = false;
    setCheckinExecutionLoading(true);
    void fetch(`/api/dashboard/booking-ops/checkin-execution?bookingId=${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<CheckinExecutionResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setCheckinExecution(null);
          return;
        }
        setCheckinExecution(payload.checkin ?? null);
      })
      .finally(() => {
        if (!cancelled) setCheckinExecutionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setInstayCheckout(null);
      return;
    }

    let cancelled = false;
    setInstayCheckoutLoading(true);
    void fetch(`/api/dashboard/booking-ops/instay-checkout?bookingId=${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
    })
      .then(async (res) => {
        const payload = await readResponseJson<InStayCheckoutResponse>(res, { ok: false });
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          setInstayCheckout(null);
          return;
        }
        setInstayCheckout(payload.instayCheckout ?? null);
      })
      .finally(() => {
        if (!cancelled) setInstayCheckoutLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function selectRecord(record: BookingOpsRecord) {
    setSelectedId(record.id);
    setDraft(draftFromRecord(record));
    setTelegramDrafts([]);
    setOpsTasks([]);
    setCommunications([]);
    setTimelineEvents([]);
    setLifecycle(null);
    setLegalPayment(null);
    setPreCheckin(null);
    setCheckinExecution(null);
    setInstayCheckout(null);
    setTaskActionResults({});
    setMessage('');
  }

  async function reloadTelegramDrafts(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/${recordId}/telegram-drafts`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<TelegramDraftResponse>(res, { ok: false });
    if (res.ok && payload.ok) setTelegramDrafts(payload.drafts ?? []);
  }

  async function onRunTaskAction(taskId: string) {
    if (!isOpsAdmin || !selectedId) return;
    setRunningTaskId(taskId);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}/tasks/${taskId}/run`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await readResponseJson<TaskRunResponse>(res, { ok: false });
      if (!res.ok || !payload.actionResult) {
        setMessage(payload.message || 'Не удалось выполнить действие задачи.');
        return;
      }
      setTaskActionResults((current) => ({
        ...current,
        [taskId]: payload.actionResult!,
      }));
      setMessage(payload.message || payload.actionResult.message);
      if (payload.actionResult.createdDraftIds?.length) {
        await reloadTelegramDrafts(selectedId);
      }
      await Promise.all([
        reloadOpsTasks(selectedId),
        reloadCommunications(selectedId),
        reloadTimeline(selectedId),
        reloadLifecycle(selectedId),
        reloadPreCheckin(selectedId),
        reloadCheckinExecution(selectedId),
        reloadInstayCheckout(selectedId),
      ]);
    } finally {
      setRunningTaskId(null);
    }
  }

  async function reloadOpsTasks(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/${recordId}/tasks`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<TasksResponse>(res, { ok: false });
    if (res.ok && payload.ok) setOpsTasks(payload.tasks ?? []);
  }

  async function reloadCommunications(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/${recordId}/communications`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<CommunicationsResponse>(res, { ok: false });
    if (res.ok && payload.ok) setCommunications(payload.communications ?? []);
  }

  async function onCommunicationAutoSendAction(
    communicationId: string,
    action: CommunicationAutoSendAction,
  ) {
    if (!isOpsAdmin || !selectedId) return;
    setUpdatingCommunicationId(communicationId);
    setMessage('');
    try {
      if (action === 'run_dry_run' || action === 'send_now' || action === 'retry_failed') {
        const res = await fetch(
          `/api/dashboard/booking-ops/${selectedId}/communications/${communicationId}/auto-send/execute`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun: action === 'run_dry_run' }),
          },
        );
        const payload = await readResponseJson<CommunicationsResponse>(res, { ok: false });
        setMessage(payload.message || (res.ok ? 'Действие выполнено.' : 'Отправка не разрешена.'));
        await reloadCommunications(selectedId);
        return;
      }
      const res = await fetch(
        `/api/dashboard/booking-ops/${selectedId}/communications/${communicationId}/auto-send`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const payload = await readResponseJson<CommunicationsResponse>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось изменить правило автоотправки.');
        return;
      }
      if (payload.communications) setCommunications(payload.communications);
      else await reloadCommunications(selectedId);
      setMessage(payload.message || 'Правило автоотправки обновлено.');
    } finally {
      setUpdatingCommunicationId(null);
    }
  }

  async function reloadTimeline(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/${recordId}/events`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<TimelineResponse>(res, { ok: false });
    if (res.ok && payload.ok) setTimelineEvents(payload.events ?? []);
  }

  async function reloadLifecycle(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/${recordId}/lifecycle`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<LifecycleResponse>(res, { ok: false });
    if (res.ok && payload.ok) setLifecycle(payload.lifecycle ?? null);
  }

  async function reloadLegalPayment(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/legal-payment?bookingId=${encodeURIComponent(recordId)}`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<LegalPaymentResponse>(res, { ok: false });
    if (res.ok && payload.ok) setLegalPayment(payload.status ?? null);
  }

  async function reloadPreCheckin(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/pre-checkin?bookingId=${encodeURIComponent(recordId)}`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<PreCheckinResponse>(res, { ok: false });
    if (res.ok && payload.ok) setPreCheckin(payload.readiness ?? null);
  }

  async function reloadCheckinExecution(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/checkin-execution?bookingId=${encodeURIComponent(recordId)}`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<CheckinExecutionResponse>(res, { ok: false });
    if (res.ok && payload.ok) setCheckinExecution(payload.checkin ?? null);
  }

  async function reloadInstayCheckout(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/instay-checkout?bookingId=${encodeURIComponent(recordId)}`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<InStayCheckoutResponse>(res, { ok: false });
    if (res.ok && payload.ok) setInstayCheckout(payload.instayCheckout ?? null);
  }

  async function onLegalPaymentAction(action: LegalPaymentAction, extra?: Record<string, unknown>) {
    if (!isOpsAdmin || !selectedId) return;
    setLegalPaymentAction(action);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops/legal-payment/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: selectedId, action, ...extra }),
      });
      const payload = await readResponseJson<LegalPaymentResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.status) {
        setMessage(payload.message || 'Не удалось обновить документы, договор, депозит или МВД.');
        return;
      }
      setLegalPayment(payload.status);
      await Promise.all([
        load(),
        reloadLifecycle(selectedId),
        reloadCommunications(selectedId),
        reloadTimeline(selectedId),
        reloadPreCheckin(selectedId),
        reloadCheckinExecution(selectedId),
        reloadInstayCheckout(selectedId),
      ]);
      setMessage('Статус обновлён.');
    } finally {
      setLegalPaymentAction(null);
    }
  }

  async function onPreCheckinAction(action: PreCheckinAction, extra?: Record<string, unknown>) {
    if (!isOpsAdmin || !selectedId) return;
    setPreCheckinAction(action);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops/pre-checkin/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: selectedId, action, ...extra }),
      });
      const payload = await readResponseJson<PreCheckinResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.readiness) {
        setMessage(payload.message || 'Не удалось обновить контроль заезда.');
        return;
      }
      setPreCheckin(payload.readiness);
      await Promise.all([
        load(),
        reloadLifecycle(selectedId),
        reloadCommunications(selectedId),
        reloadTimeline(selectedId),
        reloadCheckinExecution(selectedId),
      ]);
      setMessage(payload.message || 'Контроль заезда обновлён.');
    } finally {
      setPreCheckinAction(null);
    }
  }

  async function onCheckinExecutionAction(action: CheckinExecutionAction, extra?: Record<string, unknown>) {
    if (!isOpsAdmin || !selectedId) return;
    setCheckinExecutionAction(action);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops/checkin-execution/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: selectedId, action, ...extra }),
      });
      const payload = await readResponseJson<CheckinExecutionResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.checkin) {
        setMessage(payload.message || 'Не удалось обновить заселение.');
        return;
      }
      setCheckinExecution(payload.checkin);
      await Promise.all([
        load(),
        reloadLifecycle(selectedId),
        reloadCommunications(selectedId),
        reloadTimeline(selectedId),
        reloadPreCheckin(selectedId),
        reloadInstayCheckout(selectedId),
      ]);
      setMessage('Заселение обновлено.');
    } finally {
      setCheckinExecutionAction(null);
    }
  }

  async function onInstayCheckoutAction(action: InStayCheckoutAction, extra?: Record<string, unknown>) {
    if (!isOpsAdmin || !selectedId) return;
    setInstayCheckoutAction(action);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops/instay-checkout/action', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: selectedId, action, ...extra }),
      });
      const payload = await readResponseJson<InStayCheckoutResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.instayCheckout) {
        setMessage(payload.message || 'Не удалось обновить проживание.');
        return;
      }
      setInstayCheckout(payload.instayCheckout);
      await Promise.all([
        load(),
        reloadLifecycle(selectedId),
        reloadCommunications(selectedId),
        reloadTimeline(selectedId),
        reloadInstayCheckout(selectedId),
      ]);
      setMessage('Проживание обновлено.');
    } finally {
      setInstayCheckoutAction(null);
    }
  }

  async function onUpdateLifecycleGate(
    gateKey: BookingLifecycleGateKey,
    status: BookingLifecycleStatus,
    reason?: string,
    note?: string,
  ) {
    if (!isOpsAdmin || !selectedId) return;
    setUpdatingLifecycleGate(`${gateKey}:${status}`);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}/lifecycle`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gateKey, status, reason, note }),
      });
      const payload = await readResponseJson<LifecycleResponse>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось обновить готовность брони.');
        return;
      }
      setLifecycle(payload.lifecycle ?? null);
      await reloadPreCheckin(selectedId);
      await reloadCheckinExecution(selectedId);
      await reloadInstayCheckout(selectedId);
      setMessage('Готовность брони обновлена.');
    } finally {
      setUpdatingLifecycleGate(null);
    }
  }

  async function onUpdateTaskStatus(taskId: string, status: BookingOpsTaskStatus) {
    if (!isOpsAdmin || !selectedId) return;
    setUpdatingTaskId(taskId);
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await readResponseJson<TaskUpdateResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.task) {
        setMessage(payload.message || 'Не удалось обновить задачу.');
        return;
      }
      setMessage(payload.effectResult?.message || payload.message || 'Статус задачи обновлён.');
      await Promise.all([
        load(),
        reloadOpsTasks(selectedId),
        reloadCommunications(selectedId),
        reloadTelegramDrafts(selectedId),
        reloadTimeline(selectedId),
        reloadLifecycle(selectedId),
        reloadPreCheckin(selectedId),
      ]);
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function onRecomputePreparation() {
    if (!isOpsAdmin || !selectedId) return;
    setRecomputingPreparation(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}/recompute`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await readResponseJson<RecomputeResponse>(res, { ok: false });
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось пересчитать подготовку.');
        return;
      }
      if (payload.record) {
        setRecords((current) => current.map((item) =>
          item.id === payload.record!.id ? payload.record! : item));
        setDraft(draftFromRecord(payload.record));
      }
      if (payload.tasks) setOpsTasks(payload.tasks);
      if (payload.communications) setCommunications(payload.communications);
      if (payload.guestIntake) {
        setRecords((current) => current.map((item) =>
          item.id === selectedId ? { ...item, guestIntake: payload.guestIntake ?? null } : item));
      }
      await Promise.all([
        load(),
        reloadOpsTasks(selectedId),
        reloadCommunications(selectedId),
        reloadTimeline(selectedId),
        reloadLifecycle(selectedId),
        reloadPreCheckin(selectedId),
      ]);
      setMessage(payload.message || 'Подготовка пересчитана.');
    } finally {
      setRecomputingPreparation(false);
    }
  }

  async function onCreateTelegramDraft() {
    if (!isOpsAdmin || !selectedId || !selectedRecord?.operatorAction) return;
    setCreatingTelegramDraft(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}/telegram-drafts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId: selectedRecord.operatorAction.actionId }),
      });
      const payload = await readResponseJson<TelegramDraftResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.draft) {
        setMessage(payload.message || 'Не удалось создать черновик Telegram.');
        return;
      }
      setTelegramDrafts((current) => [payload.draft!, ...current]);
      await Promise.all([reloadOpsTasks(selectedId), reloadTimeline(selectedId), reloadLifecycle(selectedId)]);
      setMessage('Черновик Telegram создан. Сообщение не отправлено.');
    } finally {
      setCreatingTelegramDraft(false);
    }
  }

  async function onCopyTelegramDraft(draft: BookingOpsTelegramDraft) {
    await navigator.clipboard.writeText(formatBookingOpsMessageTextDisplay(draft.messageText));
    if (draft.status !== 'draft') return;

    const res = await fetch(`/api/dashboard/booking-ops/${draft.bookingOpsRecordId}/telegram-drafts`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: draft.id, status: 'copied' }),
    });
    const payload = await readResponseJson<TelegramDraftResponse>(res, { ok: false });
    if (res.ok && payload.ok && payload.draft) {
      setTelegramDrafts((current) => current.map((item) => (
        item.id === payload.draft!.id ? payload.draft! : item
      )));
      await reloadOpsTasks(draft.bookingOpsRecordId);
      await reloadTimeline(draft.bookingOpsRecordId);
      await reloadLifecycle(draft.bookingOpsRecordId);
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin || !selectedId || !draft) return;
    setSaving(true);
    setMessage('');
    try {
      const original = records.find((item) => item.id === selectedId);
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestName: resolveBookingOpsEditDraftSaveValue(
            'guestName',
            draft.guestName,
            original?.guestName,
          ),
          guestPhone: draft.guestPhone,
          guestEmail: draft.guestEmail,
          guestTelegram: draft.guestTelegram,
          propertyId: draft.propertyId,
          propertyLabel: resolveBookingOpsEditDraftSaveValue(
            'propertyLabel',
            draft.propertyLabel,
            original?.propertyLabel,
            original?.propertyId,
          ),
          otaSource: resolveBookingOpsEditDraftSaveValue(
            'otaSource',
            draft.otaSource,
            original?.otaSource,
          ),
          checkInAt: draft.checkInAt || null,
          checkOutAt: draft.checkOutAt || null,
          ...intakePayloadFromDraft(draft),
          opsStatus: draft.opsStatus,
          documentsStatus: draft.documentsStatus,
          contractStatus: draft.contractStatus,
          depositStatus: draft.depositStatus,
          mvdStatus: draft.mvdStatus,
          checkinReadinessStatus: draft.checkinReadinessStatus,
          isBlocked: draft.isBlocked,
          blockerReason: draft.blockerReason,
          manualNextAction: draft.manualNextAction,
          notes: resolveBookingOpsEditDraftSaveValue('notes', draft.notes, original?.notes),
        }),
      });
      const payload = await readResponseJson<SaveResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.record) {
        setMessage(payload.message || 'Не удалось сохранить изменения.');
        return;
      }
      setRecords((prev) => prev.map((item) => (item.id === payload.record!.id ? payload.record! : item)));
      setDraft(draftFromRecord(payload.record));
      await Promise.all([reloadOpsTasks(selectedId), reloadTimeline(selectedId), reloadLifecycle(selectedId)]);
      setMessage('Изменения сохранены.');
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmAction() {
    if (!isOpsAdmin || !selectedId || !selectedRecord?.operatorAction) return;
    const action = selectedRecord.operatorAction;
    if (!action.isAllowed) return;

    setConfirmingAction(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}/confirm-action`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId: action.actionId }),
      });
      const payload = await readResponseJson<SaveResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.record) {
        setMessage(payload.message || 'Не удалось подтвердить действие.');
        return;
      }
      setRecords((prev) => prev.map((item) => (item.id === payload.record!.id ? payload.record! : item)));
      setDraft(draftFromRecord(payload.record));
      await reloadTimeline(selectedId);
      await reloadLifecycle(selectedId);
      setMessage('Действие подтверждено, статус обновлён.');
    } finally {
      setConfirmingAction(false);
    }
  }

  async function onIntakeAction(
    eventId: string,
    action: 'process' | 'mark_duplicate' | 'attach_property' | 'attach_guest' | 'request_missing_data' | 'create_fallback',
    extra?: Record<string, string>,
  ) {
    if (!isOpsAdmin) return;
    setIntakeActionId(eventId);
    setMessage('');
    try {
      const event = intakeEvents.find((item) => item.id === eventId);
      const res = await fetch('/api/dashboard/booking-ops/intake/process', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: event?.source ?? 'admin',
          action,
          intakeEventId: eventId,
          duplicateOfBookingId: event?.bookingId ?? undefined,
          ...extra,
        }),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string; result?: { safeSummary?: string } }>(
        res,
        { ok: false },
      );
      if (!res.ok || !payload.ok) {
        setMessage(payload.message || 'Не удалось обработать заявку.');
        return;
      }
      setMessage(payload.result?.safeSummary || 'Заявка обработана.');
      await load();
    } finally {
      setIntakeActionId(null);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin) return;
    setCreating(true);
    setMessage('');
    try {
      const res = await fetch('/api/dashboard/booking-ops', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestName: createDraft.guestName,
          guestPhone: createDraft.guestPhone,
          guestEmail: createDraft.guestEmail,
          guestTelegram: createDraft.guestTelegram,
          propertyId: createDraft.propertyId,
          propertyLabel: createDraft.propertyLabel,
          otaSource: createDraft.otaSource,
          checkInAt: createDraft.checkInAt || null,
          checkOutAt: createDraft.checkOutAt || null,
          ...intakePayloadFromDraft(createDraft),
          opsStatus: createDraft.opsStatus,
          documentsStatus: createDraft.documentsStatus,
          contractStatus: createDraft.contractStatus,
          depositStatus: createDraft.depositStatus,
          mvdStatus: createDraft.mvdStatus,
          checkinReadinessStatus: createDraft.checkinReadinessStatus,
          notes: createDraft.notes,
        }),
      });
      const payload = await readResponseJson<SaveResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.record) {
        setMessage(payload.message || 'Не удалось создать запись.');
        return;
      }
      setRecords((prev) => [payload.record!, ...prev]);
      setShowCreate(false);
      selectRecord(payload.record);
      setMessage('Операционная запись создана.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Операции по броням</h1>
          <p className="mt-2 text-lg text-slate-500 leading-relaxed">
            Документы, договор, депозит, МВД и готовность к заезду — ручной контур с подсказкой следующего шага.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Обновить
          </button>
          {isOpsAdmin ? (
            <button
              type="button"
              onClick={() => setShowCreate((value) => !value)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {showCreate ? 'Скрыть форму' : 'Добавить запись'}
            </button>
          ) : null}
        </div>
      </header>

      {message ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {message}
        </div>
      ) : null}

      <ObjectSetupReadinessPanel />

      <ChannelManagerImportPanel />

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Входящие заявки</h2>
          <button
            type="button"
            onClick={() => {
              setIntakeLoading(true);
              void fetch('/api/dashboard/booking-ops/intake/events?limit=20', { credentials: 'include' })
                .then((res) => readResponseJson<IntakeEventsResponse>(res, { ok: false, events: [] }))
                .then((payload) => {
                  if (payload.ok && payload.events) setIntakeEvents(payload.events);
                })
                .finally(() => setIntakeLoading(false));
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {intakeLoading ? 'Обновление…' : 'Обновить заявки'}
          </button>
        </div>
        {intakeEvents.length === 0 ? (
          <p className="text-sm text-slate-500">Пока нет входящих заявок.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Источник</th>
                  <th className="px-2 py-2 font-medium">Контакт</th>
                  <th className="px-2 py-2 font-medium">Объект</th>
                  <th className="px-2 py-2 font-medium">Даты</th>
                  <th className="px-2 py-2 font-medium">Статус</th>
                  <th className="px-2 py-2 font-medium">Бронь</th>
                  <th className="px-2 py-2 font-medium">Действие</th>
                </tr>
              </thead>
              <tbody>
                {intakeEvents.map((event) => {
                  const modules = Array.isArray(event.automationResult?.initializedModules)
                    ? (event.automationResult.initializedModules as string[])
                    : [];
                  const expanded = expandedIntakeId === event.id;
                  return (
                    <tr key={event.id} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2">{event.source}</td>
                      <td className="px-2 py-2">{event.guestContactStatus}</td>
                      <td className="px-2 py-2">{event.propertyStatus}</td>
                      <td className="px-2 py-2">{event.datesStatus}</td>
                      <td className="px-2 py-2">
                        {event.status}
                        {event.duplicateOfBookingId ? (
                          <div className="text-amber-700">дубликат</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {event.bookingId ? (
                          <button
                            type="button"
                            className="text-emerald-700 hover:underline"
                            onClick={() => {
                              const record = records.find((item) => item.id === event.bookingId);
                              if (record) selectRecord(record);
                            }}
                          >
                            открыть
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1">
                          {isOpsAdmin ? (
                            <>
                              <button
                                type="button"
                                disabled={intakeActionId === event.id}
                                onClick={() => void onIntakeAction(event.id, 'process')}
                                className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-50"
                              >
                                обработать
                              </button>
                              <button
                                type="button"
                                disabled={intakeActionId === event.id}
                                onClick={() => void onIntakeAction(event.id, 'request_missing_data')}
                                className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50 disabled:opacity-50"
                              >
                                запросить данные
                              </button>
                              <button
                                type="button"
                                onClick={() => setExpandedIntakeId(expanded ? null : event.id)}
                                className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                              >
                                {expanded ? 'скрыть' : 'детали'}
                              </button>
                            </>
                          ) : (
                            <span className="text-slate-400">{event.nextAction ?? '—'}</span>
                          )}
                        </div>
                        {expanded ? (
                          <div className="mt-2 rounded border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-600 space-y-1">
                            <div>Недостаёт: {event.missingFields.join(', ') || '—'}</div>
                            <div>Модули: {modules.join(', ') || '—'}</div>
                            <div>След. шаг: {event.nextAction ?? '—'}</div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showCreate && isOpsAdmin ? (
        <form onSubmit={onCreate} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Новая операционная запись</h2>
          <RecordFields draft={createDraft} onChange={setCreateDraft} />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {creating ? 'Создание…' : 'Создать'}
          </button>
        </form>
      ) : null}

      {loading ? (
        <p className="text-slate-500">Загрузка…</p>
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-6 py-5 text-slate-600">
          Пока нет операционных записей по броням.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Гость</th>
                  <th className="px-4 py-3 font-medium">Готовность</th>
                  <th className="px-4 py-3 font-medium">Заезд</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Задача</th>
                  <th className="px-4 py-3 font-medium">След. шаг</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const nextAction = record.automation?.nextAction;
                  const primaryAlert = record.alerts?.primaryAlert;
                  const isSelected = record.id === selectedId;
                  return (
                    <tr
                      key={record.id}
                      tabIndex={0}
                      className={`border-t border-slate-100 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-slate-100 ring-1 ring-inset ring-slate-300'
                          : 'hover:bg-slate-100'
                      }`}
                      onClick={() => selectRecord(record)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectRecord(record);
                        }
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {formatBookingOpsGuestNameDisplay(record.guestName)}
                        </div>
                        <div className="text-slate-500">
                          {formatBookingOpsPropertyLabelDisplay(record.propertyLabel, record.propertyId)}
                        </div>
                        {record.bookingId ? (
                          <div className="mt-1 text-xs text-emerald-700">Из брони · {record.bookingId}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {record.readiness ? (
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                              READINESS_TONE[record.readiness.status]
                            }`}
                          >
                            {BOOKING_READINESS_STATUS_LABELS_RU[record.readiness.status]}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{formatWhen(record.checkInAt)}</td>
                      <td className="px-4 py-3">{BOOKING_OPS_STATUS_LABELS_RU[record.opsStatus]}</td>
                      <td className="px-4 py-3">
                        {primaryAlert ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${
                              ALERT_SEVERITY_TONE[primaryAlert.severity]
                            }`}
                          >
                            <span>{ALERT_SEVERITY_LABEL[primaryAlert.severity]}</span>
                            <span className="font-normal">{primaryAlert.title}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {nextAction ? BOOKING_OPS_NEXT_ACTION_LABELS_RU[nextAction] : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedRecord ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {formatBookingOpsGuestNameDisplay(selectedRecord.guestName)}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatBookingOpsPropertyLabelDisplay(
                      selectedRecord.propertyLabel,
                      selectedRecord.propertyId,
                    )}
                  </p>
                  {selectedRecord.bookingId ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Создано из брони · ID: {selectedRecord.bookingId}
                      {selectedRecord.otaSource
                        ? ` · ${formatBookingOpsOtaSourceDisplay(selectedRecord.otaSource)}`
                        : ''}
                    </p>
                  ) : selectedRecord.otaSource ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {formatBookingOpsOtaSourceDisplay(selectedRecord.otaSource)}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">
                  Обновлено: {formatWhen(selectedRecord.updatedAt)}
                </span>
              </div>

              {operatorGuidance ? (
                <OperatorGuidanceCard guidance={operatorGuidance} tasks={opsTasks} />
              ) : null}

              {selectedRecord.readiness ? (
                <ReadinessCard readiness={selectedRecord.readiness} />
              ) : null}

              <PreCheckinControlCenterCard
                readiness={preCheckin}
                loading={preCheckinLoading}
                isOpsAdmin={isOpsAdmin}
                activeAction={preCheckinAction}
                onAction={(action, extra) => void onPreCheckinAction(action, extra)}
                onOpenLifecycle={() => void reloadLifecycle(selectedRecord.id)}
                onOpenLegalPayment={() => void reloadLegalPayment(selectedRecord.id)}
              />

              <CheckinExecutionCard
                checkin={checkinExecution}
                loading={checkinExecutionLoading}
                isOpsAdmin={isOpsAdmin}
                activeAction={checkinExecutionAction}
                onAction={(action, extra) => void onCheckinExecutionAction(action, extra)}
              />

              <InStayCheckoutCard
                instay={instayCheckout}
                loading={instayCheckoutLoading}
                isOpsAdmin={isOpsAdmin}
                activeAction={instayCheckoutAction}
                onAction={(action, extra) => void onInstayCheckoutAction(action, extra)}
              />

              <LifecycleCard
                lifecycle={lifecycle}
                loading={lifecycleLoading}
                isOpsAdmin={isOpsAdmin}
                updatingGate={updatingLifecycleGate}
                onUpdateGate={(gateKey, status, reason, note) =>
                  void onUpdateLifecycleGate(gateKey, status, reason, note)}
              />

              <LegalPaymentCard
                status={legalPayment}
                loading={legalPaymentLoading}
                isOpsAdmin={isOpsAdmin}
                activeAction={legalPaymentAction}
                onAction={(action, extra) => void onLegalPaymentAction(action, extra)}
              />

              <GuestIntakeCard
                session={selectedRecord.guestIntake ?? null}
                isOpsAdmin={isOpsAdmin}
                recomputing={recomputingPreparation}
                onRecompute={() => void onRecomputePreparation()}
              />

              <BookingOpsTimelineCard events={timelineEvents} loading={timelineLoading} />

              <AutoSendOperationsCard
                record={selectedRecord}
                isOpsAdmin={isOpsAdmin}
                onMessage={setMessage}
              />

              <CommunicationIntentsCard
                communications={communications}
                tasks={opsTasks}
                loading={communicationsLoading}
                isOpsAdmin={isOpsAdmin}
                updatingCommunicationId={updatingCommunicationId}
                onAutoSendAction={(communicationId, action) =>
                  void onCommunicationAutoSendAction(communicationId, action)}
              />

              <TurnoverOpsCard
                record={selectedRecord}
                tasks={opsTasks}
                loading={opsTasksLoading}
                isOpsAdmin={isOpsAdmin}
                updatingTaskId={updatingTaskId}
                runningTaskId={runningTaskId}
                recomputing={recomputingPreparation}
                taskActionResults={taskActionResults}
                onUpdateStatus={(taskId, status) => void onUpdateTaskStatus(taskId, status)}
                onRunAction={(taskId) => void onRunTaskAction(taskId)}
                onRecompute={() => void onRecomputePreparation()}
              />

              <OperationalTasksCard
                tasks={opsTasks.filter((task) => !isTurnoverTaskType(task.taskType))}
                loading={opsTasksLoading}
                isOpsAdmin={isOpsAdmin}
                updatingTaskId={updatingTaskId}
                runningTaskId={runningTaskId}
                taskActionResults={taskActionResults}
                onUpdateStatus={(taskId, status) => void onUpdateTaskStatus(taskId, status)}
                onRunAction={(taskId) => void onRunTaskAction(taskId)}
              />

              {selectedRecord.automation ? (
                <div
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    AUTOMATION_TONE[selectedRecord.automation.automationState] ?? AUTOMATION_TONE.action_required
                  }`}
                >
                  <p className="font-medium">
                    Следующее действие:{' '}
                    {BOOKING_OPS_NEXT_ACTION_LABELS_RU[selectedRecord.automation.nextAction]}
                  </p>
                  <p className="mt-1">{selectedRecord.automation.reason}</p>
                  {selectedRecord.automation.blockers.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      {selectedRecord.automation.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {isOpsAdmin && selectedRecord.operatorAction ? (
                <OperatorActionPanel
                  action={selectedRecord.operatorAction}
                  confirming={confirmingAction}
                  creatingTelegramDraft={creatingTelegramDraft}
                  telegramDraftsLoading={telegramDraftsLoading}
                  telegramDraft={telegramDrafts.find(
                    (item) => item.actionId === selectedRecord.operatorAction?.actionId,
                  ) ?? null}
                  onConfirm={() => void onConfirmAction()}
                  onCreateTelegramDraft={() => void onCreateTelegramDraft()}
                  onCopyTelegramDraft={onCopyTelegramDraft}
                />
              ) : null}

              {selectedRecord.alerts && selectedRecord.alerts.alerts.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-800">Задачи оператора</h3>
                  {selectedRecord.alerts.alerts.map((alert) => (
                    <div
                      key={`${alert.kind}-${alert.title}`}
                      className={`rounded-lg border px-4 py-3 text-sm ${
                        ALERT_SEVERITY_TONE[alert.severity]
                      }`}
                    >
                      <p className="font-medium">
                        {ALERT_SEVERITY_LABEL[alert.severity]} · {alert.title}
                      </p>
                      <p className="mt-1">{alert.reason}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {isOpsAdmin && draft ? (
                <form onSubmit={onSave} className="space-y-4 border-t border-slate-200 pt-4">
                  <h3 className="text-base font-semibold text-slate-900">Редактирование</h3>

                  <RecordFields draft={draft} onChange={setDraft} />
                  <IntakeFields draft={draft} onChange={setDraft} />

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={draft.isBlocked}
                      onChange={(event) => setDraft({ ...draft, isBlocked: event.target.checked })}
                    />
                    Заблокировано
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Причина блокировки</span>
                    <input
                      value={draft.blockerReason}
                      onChange={(event) => setDraft({ ...draft, blockerReason: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Ручной следующий шаг</span>
                    <input
                      value={draft.manualNextAction}
                      onChange={(event) => setDraft({ ...draft, manualNextAction: event.target.value })}
                      placeholder="Оставьте пустым для автоматической подсказки"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Заметки</span>
                    <textarea
                      value={draft.notes}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  >
                    {saving ? 'Сохранение…' : 'Сохранить'}
                  </button>
                </form>
              ) : !isOpsAdmin ? (
                <p className="border-t border-slate-200 pt-4 text-sm text-slate-500">
                  Редактирование доступно администратору OPS.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Выберите запись в списке слева.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OperatorGuidanceCard({
  guidance,
  tasks,
}: {
  guidance: BookingOpsOperatorGuidance;
  tasks: BookingOpsTask[];
}) {
  const task = tasks.find((item) =>
    item.taskType === guidance.recommendedTaskType
    && (item.status === 'open' || item.status === 'in_progress' || item.status === 'blocked'),
  );

  function pointToTask() {
    if (!task) return;
    document.getElementById(`booking-ops-task-${task.id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Следующий шаг</p>
      <p className="mt-1 font-semibold">{guidance.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-indigo-900">{guidance.description}</p>
      {guidance.blockingReason ? (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">
          Блокировка: {guidance.blockingReason}
        </p>
      ) : null}
      <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {guidance.progress.map((item) => (
          <li
            key={item.stage}
            className={
              item.status === 'completed'
                ? 'text-emerald-700'
                : item.status === 'current'
                  ? 'font-semibold text-indigo-900'
                  : 'text-slate-400'
            }
          >
            {item.status === 'completed' ? '✓' : item.status === 'current' ? '●' : '○'} {item.label}
          </li>
        ))}
      </ol>
      {guidance.recommendedActionLabel ? (
        <button
          type="button"
          disabled={!task}
          onClick={pointToTask}
          className="mt-3 rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100 disabled:cursor-default disabled:opacity-60"
        >
          {task ? `К задаче: ${guidance.recommendedActionLabel}` : guidance.recommendedActionLabel}
        </button>
      ) : null}
    </section>
  );
}

function PreCheckinControlCenterCard({
  readiness,
  loading,
  isOpsAdmin,
  activeAction,
  onAction,
  onOpenLifecycle,
  onOpenLegalPayment,
}: {
  readiness: PreCheckinReadinessSnapshot | null;
  loading: boolean;
  isOpsAdmin: boolean;
  activeAction: PreCheckinAction | null;
  onAction: (action: PreCheckinAction, extra?: Record<string, unknown>) => void;
  onOpenLifecycle: () => void;
  onOpenLegalPayment: () => void;
}) {
  function createFallback() {
    const reason = window.prompt('Причина ручного плана', readiness?.topBlocker?.reason ?? '');
    if (!reason) return;
    onAction('create_fallback', { reason });
  }

  function addNote() {
    const note = window.prompt('Заметка к контролю заезда');
    if (!note) return;
    onAction('add_note', { note });
  }

  function blockTopGate() {
    if (!readiness?.topBlocker?.gateKey) return;
    const reason = window.prompt('Причина блокировки', readiness.topBlocker.reason);
    if (!reason) return;
    onAction('block_gate', { gateKey: readiness.topBlocker.gateKey, reason });
  }

  function skipTopGate() {
    if (!readiness?.topBlocker?.gateKey) return;
    const reason = window.prompt('Почему этап можно пропустить', 'Пропущено вручную');
    if (!reason) return;
    onAction('skip_gate', { gateKey: readiness.topBlocker.gateKey, reason });
  }

  const status = readiness?.status ?? 'needs_attention';
  const tone = PRE_CHECKIN_TONE[status];

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Контроль заезда</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>
            {PRE_CHECKIN_READINESS_STATUS_LABELS_RU[status]}
          </span>
          <span className="text-xl font-semibold text-slate-900">
            {loading ? '…' : `${readiness?.readinessScore ?? 0}%`}
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500">Загрузка контроля заезда…</p>
      ) : !readiness ? (
        <p className="text-slate-500">Контроль заезда появится после пересчёта.</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-500">Главный блокер</p>
              <p className="mt-1 font-medium text-slate-900">
                {readiness.topBlocker?.title ?? 'Нет блокеров'}
              </p>
              {readiness.topBlocker ? (
                <p className="mt-1 text-xs text-slate-600">{readiness.topBlocker.reason}</p>
              ) : null}
            </div>
            <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-700">Предупреждения</p>
              <p className="mt-1 text-xl font-semibold text-amber-950">{readiness.warnings.length}</p>
            </div>
            <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2">
              <p className="text-xs font-medium text-sky-700">Lifecycle</p>
              <p className="mt-1 text-xl font-semibold text-sky-950">{readiness.lifecycleScore}%</p>
            </div>
          </div>

          {readiness.requiredActions.length > 0 ? (
            <div>
              <p className="font-medium text-slate-800">Следующее действие</p>
              <p className="mt-1 text-slate-700">
                {readiness.requiredActions[0].title} · {readiness.requiredActions[0].action}
              </p>
            </div>
          ) : null}

          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              Блокеры и предупреждения
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="font-medium text-slate-800">Блокеры</p>
                {readiness.hardBlockers.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-slate-700">
                    {readiness.hardBlockers.map((item) => (
                      <li key={`${item.key}-${item.source}`}>
                        {item.title}: {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Нет.</p>
                )}
              </div>
              <div>
                <p className="font-medium text-slate-800">Предупреждения</p>
                {readiness.warnings.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-slate-700">
                    {readiness.warnings.map((item) => (
                      <li key={`${item.key}-${item.source}`}>
                        {item.title}: {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Нет.</p>
                )}
              </div>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Пересчёт: {formatWhen(readiness.lastRecomputedAt)}</span>
            <button type="button" onClick={onOpenLifecycle} className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700">
              Открыть lifecycle
            </button>
            <button type="button" onClick={onOpenLegalPayment} className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700">
              Открыть документы/договор/депозит/МВД
            </button>
          </div>

          {isOpsAdmin ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={activeAction !== null} onClick={() => onAction('recompute')} className="rounded border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-900 disabled:opacity-50">
                {activeAction === 'recompute' ? 'Пересчёт…' : PRE_CHECKIN_ACTION_LABELS_RU.recompute}
              </button>
              <button type="button" disabled={activeAction !== null} onClick={() => onAction('mark_ready_override')} className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.mark_ready_override}
              </button>
              <button type="button" disabled={activeAction !== null} onClick={() => onAction('clear_ready_override')} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.clear_ready_override}
              </button>
              <button type="button" disabled={activeAction !== null || !readiness.topBlocker?.fallbackEligible} onClick={createFallback} className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-900 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.create_fallback}
              </button>
              <button type="button" disabled={activeAction !== null || !readiness.topBlocker?.gateKey} onClick={() => onAction('resolve_fallback', { gateKey: readiness.topBlocker?.gateKey })} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.resolve_fallback}
              </button>
              <button type="button" disabled={activeAction !== null} onClick={addNote} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.add_note}
              </button>
              <button type="button" disabled={activeAction !== null || !readiness.topBlocker?.gateKey} onClick={blockTopGate} className="rounded border border-red-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-900 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.block_gate}
              </button>
              <button type="button" disabled={activeAction !== null || !readiness.topBlocker?.gateKey} onClick={skipTopGate} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                {PRE_CHECKIN_ACTION_LABELS_RU.skip_gate}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function CheckinExecutionCard({
  checkin,
  loading,
  isOpsAdmin,
  activeAction,
  onAction,
}: {
  checkin: CheckinExecutionSnapshot | null;
  loading: boolean;
  isOpsAdmin: boolean;
  activeAction: CheckinExecutionAction | null;
  onAction: (action: CheckinExecutionAction, extra?: Record<string, unknown>) => void;
}) {
  const status = checkin?.status ?? 'not_ready';
  const tone = CHECKIN_EXECUTION_TONE[status];

  function reportAccessIssue() {
    const reason = window.prompt('Что случилось с доступом?');
    if (!reason) return;
    onAction('report_access_issue', { reason });
  }

  function createFallback() {
    const reason = window.prompt('Причина ручного плана', checkin?.blockers[0]?.reason ?? '');
    if (!reason) return;
    onAction('create_fallback', { reason });
  }

  function addNote() {
    const note = window.prompt('Заметка по заселению');
    if (!note) return;
    onAction('add_note', { note });
  }

  function markArrivalConfirmed() {
    const arrivalTime = window.prompt('Время прибытия', new Date().toISOString());
    onAction('mark_arrival_confirmed', arrivalTime ? { arrivalTime } : undefined);
  }

  const canCreateFallback = Boolean(checkin?.blockers.some((item) => item.fallbackEligible));

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Заселение</h3>
          <p className="mt-1 text-xs text-slate-500">
            Инструкции, прибытие гостя и доступ без автоотправки.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>
          {CHECKIN_EXECUTION_STATUS_LABELS_RU[status]}
        </span>
      </div>

      {loading ? (
        <p className="text-slate-500">Загрузка заселения…</p>
      ) : !checkin ? (
        <p className="text-slate-500">Статус заселения появится после проверки брони.</p>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-4">
            <CheckinMetric label="Инструкции" value={CHECKIN_INSTRUCTIONS_STATUS_LABELS_RU[checkin.instructionsStatus]} />
            <CheckinMetric label="Прибытие" value={CHECKIN_ARRIVAL_STATUS_LABELS_RU[checkin.arrivalStatus]} />
            <CheckinMetric label="Доступ" value={CHECKIN_ACCESS_STATUS_LABELS_RU[checkin.accessStatus]} />
            <CheckinMetric
              label="Гость"
              value={checkin.status === 'checked_in' ? 'Заехал' : 'Не отмечен'}
            />
          </div>

          {checkin.nextAction ? (
            <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sky-950">
              <p className="text-xs font-medium text-sky-700">Следующее действие</p>
              <p className="mt-1">{checkin.nextAction}</p>
            </div>
          ) : null}

          {checkin.blockers.length > 0 ? (
            <details className="rounded-md border border-red-100 bg-red-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-red-900">
                Блокеры: {checkin.blockers.length}
              </summary>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-red-950">
                {checkin.blockers.map((item) => (
                  <li key={item.key}>
                    {item.title}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="text-xs text-slate-500">Блокеров по заселению нет.</p>
          )}

          {isOpsAdmin ? (
            <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Действия оператора
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <CheckinActionButton action="prepare_instructions" activeAction={activeAction} onAction={onAction} />
                <CheckinActionButton action="queue_instructions" activeAction={activeAction} onAction={onAction} />
                <CheckinActionButton action="mark_instructions_sent" activeAction={activeAction} onAction={onAction} />
                <CheckinActionButton action="request_arrival_confirmation" activeAction={activeAction} onAction={onAction} />
                <button type="button" disabled={activeAction !== null} onClick={markArrivalConfirmed} className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 disabled:opacity-50">
                  {CHECKIN_EXECUTION_ACTION_LABELS_RU.mark_arrival_confirmed}
                </button>
                <CheckinActionButton action="mark_access_ready" activeAction={activeAction} onAction={onAction} />
                <button type="button" disabled={activeAction !== null} onClick={reportAccessIssue} className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-900 disabled:opacity-50">
                  {CHECKIN_EXECUTION_ACTION_LABELS_RU.report_access_issue}
                </button>
                <CheckinActionButton action="resolve_access_issue" activeAction={activeAction} onAction={onAction} />
                <CheckinActionButton action="mark_guest_checked_in" activeAction={activeAction} onAction={onAction} />
                <button type="button" disabled={activeAction !== null || !canCreateFallback} onClick={createFallback} className="rounded border border-red-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-900 disabled:opacity-50">
                  {CHECKIN_EXECUTION_ACTION_LABELS_RU.create_fallback}
                </button>
                <button type="button" disabled={activeAction !== null} onClick={addNote} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                  {CHECKIN_EXECUTION_ACTION_LABELS_RU.add_note}
                </button>
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function CheckinMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-900">{value}</p>
    </div>
  );
}

function CheckinActionButton({
  action,
  activeAction,
  onAction,
}: {
  action: CheckinExecutionAction;
  activeAction: CheckinExecutionAction | null;
  onAction: (action: CheckinExecutionAction, extra?: Record<string, unknown>) => void;
}) {
  return (
    <button
      type="button"
      disabled={activeAction !== null}
      onClick={() => onAction(action)}
      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
    >
      {activeAction === action ? 'Сохранение…' : CHECKIN_EXECUTION_ACTION_LABELS_RU[action]}
    </button>
  );
}

function InStayCheckoutCard({
  instay,
  loading,
  isOpsAdmin,
  activeAction,
  onAction,
}: {
  instay: InStayCheckoutSnapshot | null;
  loading: boolean;
  isOpsAdmin: boolean;
  activeAction: InStayCheckoutAction | null;
  onAction: (action: InStayCheckoutAction, extra?: Record<string, unknown>) => void;
}) {
  const status = instay?.status ?? 'not_checked_in';
  const tone = INSTAY_CHECKOUT_TONE[status];

  function createGuestIssue() {
    const issueType = window.prompt('Тип обращения', 'general');
    if (!issueType) return;
    const description = window.prompt('Описание для гостя');
    if (!description) return;
    const severity = window.prompt('Срочность: low / medium / high / urgent', 'medium') || 'medium';
    onAction('create_guest_issue', { issueType, description, severity });
  }

  function resolveGuestIssue() {
    const issueId = instay?.openIssues[0]?.id;
    if (!issueId) {
      window.alert('Нет открытых обращений.');
      return;
    }
    const resolution = window.prompt('Как закрыли обращение?');
    if (!resolution) return;
    onAction('resolve_guest_issue', { issueId, resolution });
  }

  function markInspectionDone() {
    const result = window.prompt('Результат осмотра: ok / issue_found / failed', 'ok');
    if (!result) return;
    onAction('mark_post_checkout_inspection_done', { result });
  }

  function createFallback() {
    const reason = window.prompt('Причина ручного плана', instay?.blockers[0]?.reason ?? '');
    if (!reason) return;
    onAction('create_fallback', { reason });
  }

  function addNote() {
    const note = window.prompt('Заметка по проживанию');
    if (!note) return;
    onAction('add_note', { note });
  }

  const canCreateFallback = Boolean(instay?.blockers.some((item) => item.fallbackEligible));

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Проживание / выезд</h3>
          <p className="mt-1 text-xs text-slate-500">
            Поддержка гостя, выезд, осмотр и возврат депозита без автоотправки.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>
          {INSTAY_CHECKOUT_STATUS_LABELS_RU[status]}
        </span>
      </div>

      {loading ? (
        <p className="text-slate-500">Загрузка проживания…</p>
      ) : !instay ? (
        <p className="text-slate-500">Статус проживания появится после проверки брони.</p>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
            <CheckinMetric label="Обращения" value={String(instay.openIssuesCount)} />
            <CheckinMetric label="Инструкции" value={INSTAY_CHECKOUT_INSTRUCTIONS_LABELS_RU[instay.checkoutInstructionsStatus]} />
            <CheckinMetric label="Выезд" value={INSTAY_CHECKOUT_CONFIRMATION_LABELS_RU[instay.checkoutConfirmationStatus]} />
            <CheckinMetric label="Осмотр" value={INSTAY_CHECKOUT_INSPECTION_LABELS_RU[instay.inspectionStatus]} />
            <CheckinMetric label="Депозит" value={INSTAY_CHECKOUT_DEPOSIT_LABELS_RU[instay.depositReturnStatus]} />
            <CheckinMetric label="Закрытие" value={INSTAY_CHECKOUT_CLOSURE_LABELS_RU[instay.closureStatus]} />
          </div>

          {instay.nextAction ? (
            <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-sky-950">
              <p className="text-xs font-medium text-sky-700">Следующее действие</p>
              <p className="mt-1">{instay.nextAction}</p>
            </div>
          ) : null}

          {instay.blockers.length > 0 ? (
            <details className="rounded-md border border-red-100 bg-red-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-red-900">
                Блокеры: {instay.blockers.length}
              </summary>
              <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-red-950">
                {instay.blockers.map((item) => (
                  <li key={item.key}>
                    {item.title}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="text-xs text-slate-500">Блокеров по проживанию нет.</p>
          )}

          {isOpsAdmin ? (
            <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Действия оператора
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <InStayActionButton action="open_support_window" activeAction={activeAction} onAction={onAction} />
                <button type="button" disabled={activeAction !== null} onClick={createGuestIssue} className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-50">
                  {INSTAY_CHECKOUT_ACTION_LABELS_RU.create_guest_issue}
                </button>
                <button type="button" disabled={activeAction !== null} onClick={resolveGuestIssue} className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 disabled:opacity-50">
                  {INSTAY_CHECKOUT_ACTION_LABELS_RU.resolve_guest_issue}
                </button>
                <InStayActionButton action="prepare_checkout_instructions" activeAction={activeAction} onAction={onAction} />
                <InStayActionButton action="queue_checkout_instructions" activeAction={activeAction} onAction={onAction} />
                <InStayActionButton action="mark_checkout_instructions_sent" activeAction={activeAction} onAction={onAction} />
                <InStayActionButton action="request_checkout_confirmation" activeAction={activeAction} onAction={onAction} />
                <InStayActionButton action="mark_guest_checked_out" activeAction={activeAction} onAction={onAction} />
                <InStayActionButton action="trigger_post_checkout_inspection" activeAction={activeAction} onAction={onAction} />
                <button type="button" disabled={activeAction !== null} onClick={markInspectionDone} className="rounded border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-xs font-medium text-violet-900 disabled:opacity-50">
                  {INSTAY_CHECKOUT_ACTION_LABELS_RU.mark_post_checkout_inspection_done}
                </button>
                <InStayActionButton action="mark_deposit_return_ready" activeAction={activeAction} onAction={onAction} />
                <InStayActionButton action="mark_booking_closed" activeAction={activeAction} onAction={onAction} />
                <button type="button" disabled={activeAction !== null || !canCreateFallback} onClick={createFallback} className="rounded border border-red-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-900 disabled:opacity-50">
                  {INSTAY_CHECKOUT_ACTION_LABELS_RU.create_fallback}
                </button>
                <button type="button" disabled={activeAction !== null} onClick={addNote} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">
                  {INSTAY_CHECKOUT_ACTION_LABELS_RU.add_note}
                </button>
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function InStayActionButton({
  action,
  activeAction,
  onAction,
}: {
  action: InStayCheckoutAction;
  activeAction: InStayCheckoutAction | null;
  onAction: (action: InStayCheckoutAction, extra?: Record<string, unknown>) => void;
}) {
  return (
    <button
      type="button"
      disabled={activeAction !== null}
      onClick={() => onAction(action)}
      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
    >
      {activeAction === action ? 'Сохранение…' : INSTAY_CHECKOUT_ACTION_LABELS_RU[action]}
    </button>
  );
}

const LIFECYCLE_STATUS_TONE: Record<BookingLifecycleStatus, string> = {
  pending: 'border-slate-200 bg-slate-50 text-slate-700',
  in_progress: 'border-sky-200 bg-sky-50 text-sky-900',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  blocked: 'border-red-200 bg-red-50 text-red-900',
  skipped: 'border-slate-200 bg-white text-slate-500',
  failed: 'border-rose-300 bg-rose-50 text-rose-900',
};

function LifecycleGatePill({ gate }: { gate: BookingLifecycleGate }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${LIFECYCLE_STATUS_TONE[gate.status]}`}>
      {BOOKING_LIFECYCLE_GATE_LABELS_RU[gate.gateKey]} · {BOOKING_LIFECYCLE_STATUS_LABELS_RU[gate.status]}
    </span>
  );
}

function LifecycleCard({
  lifecycle,
  loading,
  isOpsAdmin,
  updatingGate,
  onUpdateGate,
}: {
  lifecycle: BookingLifecycleSnapshot | null;
  loading: boolean;
  isOpsAdmin: boolean;
  updatingGate: string | null;
  onUpdateGate: (
    gateKey: BookingLifecycleGateKey,
    status: BookingLifecycleStatus,
    reason?: string,
    note?: string,
  ) => void;
}) {
  const visibleGates = lifecycle?.gates ?? [];
  const active = lifecycle?.currentActiveGate ?? null;
  const completedPreview = lifecycle?.completedGates.slice(-8) ?? [];

  function blockGate(gate: BookingLifecycleGate) {
    const reason = window.prompt('Причина блокировки');
    if (!reason) return;
    onUpdateGate(gate.gateKey, 'blocked', reason);
  }

  function addNote(gate: BookingLifecycleGate) {
    const note = window.prompt('Заметка к этапу', gate.note ?? '');
    if (!note) return;
    onUpdateGate(gate.gateKey, gate.status, gate.reason ?? undefined, note);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Lifecycle / Готовность брони</h3>
          <p className="mt-1 text-xs text-slate-500">
            Единый список этапов до закрытия брони. Внешние провайдеры пока не подключены.
          </p>
        </div>
        <div className="min-w-28 text-right">
          <p className="text-2xl font-semibold text-slate-900">
            {loading ? '…' : `${lifecycle?.readinessScore ?? 0}%`}
          </p>
          <p className="text-xs text-slate-500">готовность</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Загрузка готовности брони…</p>
      ) : !lifecycle ? (
        <p className="text-sm text-slate-500">Готовность брони появится после пересчета.</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-500">Текущий этап</p>
              <p className="mt-1 font-medium text-slate-900">
                {active ? BOOKING_LIFECYCLE_GATE_LABELS_RU[active.gateKey] : 'Нет активных этапов'}
              </p>
              {active ? (
                <p className="mt-1 text-xs text-slate-500">
                  {BOOKING_LIFECYCLE_STATUS_LABELS_RU[active.status]}
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2">
              <p className="text-xs font-medium text-red-700">Блокеры</p>
              <p className="mt-1 text-xl font-semibold text-red-900">{lifecycle.blockedGates.length}</p>
            </div>
            <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
              <p className="text-xs font-medium text-emerald-700">Выполнено</p>
              <p className="mt-1 text-xl font-semibold text-emerald-900">{lifecycle.completedGates.length}</p>
            </div>
          </div>

          {lifecycle.blockedGates.length > 0 ? (
            <div>
              <p className="font-medium text-slate-800">Проблемы</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {lifecycle.blockedGates.map((gate) => (
                  <LifecycleGatePill key={gate.gateKey} gate={gate} />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="font-medium text-slate-800">Следующие действия</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {lifecycle.nextRequiredGates.length > 0 ? lifecycle.nextRequiredGates.map((gate) => (
                <LifecycleGatePill key={gate.gateKey} gate={gate} />
              )) : (
                <span className="text-xs text-slate-500">Все обязательные этапы закрыты.</span>
              )}
            </div>
          </div>

          {completedPreview.length > 0 ? (
            <div>
              <p className="font-medium text-slate-800">Последние выполненные</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {completedPreview.map((gate) => (
                  <LifecycleGatePill key={gate.gateKey} gate={gate} />
                ))}
              </div>
            </div>
          ) : null}

          {lifecycle.exceptions.length > 0 ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-950">
              <p className="font-medium">Исключения</p>
              <ul className="mt-1 list-disc pl-5 text-xs space-y-1">
                {lifecycle.exceptions.map((item) => (
                  <li key={item.id}>
                    {BOOKING_LIFECYCLE_GATE_LABELS_RU[item.gateKey]}: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isOpsAdmin ? (
            <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-700">
                Ручные действия по этапам
              </summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {visibleGates.map((gate) => (
                  <div key={gate.gateKey} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">
                          {BOOKING_LIFECYCLE_GATE_LABELS_RU[gate.gateKey]}
                        </p>
                        <p className="text-xs text-slate-500">
                          {BOOKING_LIFECYCLE_STATUS_LABELS_RU[gate.status]}
                          {gate.note ? ` · ${gate.note}` : ''}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${LIFECYCLE_STATUS_TONE[gate.status]}`}>
                        {BOOKING_LIFECYCLE_STATUS_LABELS_RU[gate.status]}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={updatingGate !== null}
                        onClick={() => onUpdateGate(gate.gateKey, 'completed')}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900 disabled:opacity-50"
                      >
                        Готово
                      </button>
                      <button
                        type="button"
                        disabled={updatingGate !== null}
                        onClick={() => blockGate(gate)}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-900 disabled:opacity-50"
                      >
                        Блок
                      </button>
                      <button
                        type="button"
                        disabled={updatingGate !== null}
                        onClick={() => onUpdateGate(gate.gateKey, 'skipped', 'Пропущено вручную')}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                      >
                        Пропустить
                      </button>
                      <button
                        type="button"
                        disabled={updatingGate !== null}
                        onClick={() => addNote(gate)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                      >
                        Заметка
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

const LEGAL_PAYMENT_ACTION_LABELS_RU: Record<LegalPaymentAction, string> = {
  initialize: 'Инициализировать',
  request_documents: 'Запросить документы',
  documents_received: 'Документы получены',
  verify_documents: 'Проверить документы',
  reject_documents: 'Отклонить документы',
  prepare_contract: 'Подготовить договор',
  contract_sent: 'Договор отправлен',
  contract_signed: 'Договор подписан',
  request_deposit: 'Запросить депозит',
  deposit_received: 'Депозит получен',
  waive_deposit: 'Отменить депозит',
  prepare_mvd_report: 'Подготовить МВД',
  mvd_report_submitted: 'МВД отправлен',
  mvd_report_accepted: 'МВД принят',
};

const LEGAL_PAYMENT_STATUS_TONE: Record<string, string> = {
  requested: 'border-sky-200 bg-sky-50 text-sky-900',
  received: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  rejected: 'border-red-200 bg-red-50 text-red-900',
  expired: 'border-red-200 bg-red-50 text-red-900',
  missing: 'border-amber-200 bg-amber-50 text-amber-900',
  not_started: 'border-slate-200 bg-slate-50 text-slate-700',
  prepared: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  sent: 'border-sky-200 bg-sky-50 text-sky-900',
  signed: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  not_requested: 'border-slate-200 bg-slate-50 text-slate-700',
  refunded: 'border-slate-200 bg-slate-50 text-slate-700',
  partially_refunded: 'border-slate-200 bg-slate-50 text-slate-700',
  waived: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  submitted: 'border-sky-200 bg-sky-50 text-sky-900',
  accepted: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  failed: 'border-red-200 bg-red-50 text-red-900',
};

const LEGAL_PAYMENT_STATUS_LABELS_RU: Record<string, string> = {
  requested: 'Запрошено',
  received: 'Получено',
  verified: 'Проверено',
  rejected: 'Отклонено',
  expired: 'Просрочено',
  missing: 'Нет',
  not_started: 'Не начато',
  prepared: 'Подготовлено',
  sent: 'Отправлено',
  signed: 'Подписано',
  not_requested: 'Не запрошен',
  refunded: 'Возвращён',
  partially_refunded: 'Частично возвращён',
  waived: 'Отменён',
  submitted: 'Отправлено',
  accepted: 'Принято',
  failed: 'Ошибка',
};

function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
      LEGAL_PAYMENT_STATUS_TONE[value] ?? LEGAL_PAYMENT_STATUS_TONE.not_started
    }`}>
      {LEGAL_PAYMENT_STATUS_LABELS_RU[value] ?? value}
    </span>
  );
}

function LegalPaymentCard({
  status,
  loading,
  isOpsAdmin,
  activeAction,
  onAction,
}: {
  status: LegalPaymentStatus | null;
  loading: boolean;
  isOpsAdmin: boolean;
  activeAction: LegalPaymentAction | null;
  onAction: (action: LegalPaymentAction, extra?: Record<string, unknown>) => void;
}) {
  const firstDocumentStatus = status?.documents[0]?.status ?? 'not_started';
  const blockers = status?.blockers ?? [];

  function runAction(action: LegalPaymentAction) {
    if (action === 'reject_documents') {
      const reason = window.prompt('Причина отклонения документов');
      if (!reason) return;
      onAction(action, { reason });
      return;
    }
    if (action === 'request_deposit') {
      const amountRaw = window.prompt('Сумма депозита', status?.deposit?.amount ? String(status.deposit.amount) : '0');
      if (amountRaw == null) return;
      const currency = window.prompt('Валюта', status?.deposit?.currency ?? 'RUB');
      onAction(action, { amount: Number(amountRaw), currency: currency || 'RUB' });
      return;
    }
    if (action === 'waive_deposit') {
      const reason = window.prompt('Причина отмены депозита');
      if (!reason) return;
      onAction(action, { reason });
      return;
    }
    if (action === 'request_documents') {
      onAction(action, { requiredDocuments: ['passport'] });
      return;
    }
    onAction(action);
  }

  const groups: Array<{
    title: string;
    status: string;
    details: string;
    actions: LegalPaymentAction[];
  }> = [
    {
      title: 'Документы',
      status: firstDocumentStatus,
      details: status?.documents.length
        ? `${status.documents.length} записей`
        : 'Запрос ещё не создан',
      actions: ['request_documents', 'documents_received', 'verify_documents', 'reject_documents'],
    },
    {
      title: 'Договор',
      status: status?.contract?.status ?? 'not_started',
      details: status?.contract?.provider ? `Провайдер: ${status.contract.provider}` : 'Ручной режим',
      actions: ['prepare_contract', 'contract_sent', 'contract_signed'],
    },
    {
      title: 'Депозит',
      status: status?.deposit?.status ?? 'not_requested',
      details: status?.deposit
        ? `${status.deposit.amount} ${status.deposit.currency}`
        : 'Сумма не задана',
      actions: ['request_deposit', 'deposit_received', 'waive_deposit'],
    },
    {
      title: 'МВД',
      status: status?.mvdReport?.status ?? 'not_started',
      details: status?.mvdReport?.provider ? `Провайдер: ${status.mvdReport.provider}` : 'Ручной режим',
      actions: ['prepare_mvd_report', 'mvd_report_submitted', 'mvd_report_accepted'],
    },
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Документы / договор / залог / МВД</h3>
          <p className="mt-1 text-xs text-slate-500">
            Ручной контур статусов и черновиков. Внешние отправки отключены.
          </p>
        </div>
        {isOpsAdmin ? (
          <button
            type="button"
            disabled={activeAction !== null}
            onClick={() => runAction('initialize')}
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
          >
            {activeAction === 'initialize' ? 'Обновление…' : 'Инициализировать'}
          </button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Загрузка статусов…</p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {groups.map((group) => (
              <article key={group.title} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{group.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{group.details}</p>
                  </div>
                  <StatusBadge value={group.status} />
                </div>
                {isOpsAdmin ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.actions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={activeAction !== null}
                        onClick={() => runAction(action)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {activeAction === action ? '...' : LEGAL_PAYMENT_ACTION_LABELS_RU[action]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="font-medium text-slate-800">Влияние на готовность</p>
            {blockers.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-red-900 space-y-1">
                {blockers.map((blocker) => (
                  <li key={`${blocker.gateKey}-${blocker.reason}`}>
                    {BOOKING_LIFECYCLE_GATE_LABELS_RU[
                      blocker.gateKey as keyof typeof BOOKING_LIFECYCLE_GATE_LABELS_RU
                    ] ?? blocker.gateKey}: {blocker.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Критических блокеров по этому блоку нет. Готовность считается по lifecycle-этапам.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const COMMUNICATION_PURPOSE_LABELS_RU: Record<string, string> = {
  request_missing_guest_data: 'Запросить недостающие данные',
  request_arrival_time: 'Уточнить время прибытия',
  neutral_booking_acknowledgement: 'Подтвердить получение',
  neutral_status_update: 'Сообщить статус',
  cleaner_task_assignment: 'Назначить уборку',
  cleaner_task_reminder: 'Напомнить об уборке',
  linen_task_assignment: 'Назначить работу с бельём',
  inspection_task_assignment: 'Назначить проверку',
  master_task_assignment: 'Назначить задачу мастеру',
  master_task_reminder: 'Напомнить мастеру',
  internal_status_notice: 'Внутреннее уведомление',
  fallback_created_notice: 'Уведомить о ручной обработке',
  task_overdue_notice: 'Уведомить о просроченной задаче',
  request_guest_documents: 'Запросить документы',
  request_contract_confirmation: 'Подтвердить договор',
  request_deposit_payment: 'Запросить депозит',
  request_mvd_data: 'Запросить данные МВД',
  send_checkin_instructions: 'Инструкции заезда',
  remind_guest_before_checkin: 'Напомнить перед заездом',
  checkout_reminder: 'Напомнить о выезде',
  cleaning_assignment: 'Назначить уборку',
  cleaning_reminder: 'Напомнить об уборке',
  inspection_request: 'Запросить осмотр',
  issue_followup: 'Проверить проблему',
  checkin_instructions: 'Инструкции заезда',
  arrival_confirmation_request: 'Подтвердить прибытие',
  access_issue_followup: 'Проблема доступа',
  linen_pickup_request: 'Забрать бельё',
  linen_delivery_request: 'Доставить бельё',
  linen_status_check: 'Проверить бельё',
  maintenance_request: 'Передать мастеру',
  repair_status_check: 'Проверить ремонт',
  preparation_blocked_notice: 'Подготовка заблокирована',
  readiness_confirmation_needed: 'Подтвердить готовность',
  guest_data_missing_notice: 'Не хватает данных гостя',
  unit_ready_notice: 'Объект готов',
  issue_escalation_notice: 'Эскалация проблемы',
};

const COMMUNICATION_CHANNEL_LABELS_RU: Record<string, string> = {
  telegram: 'Telegram',
  email: 'E-mail',
  phone: 'Телефон',
  internal: 'Внутри ASI',
  manual: 'Вручную',
};

const AUTO_SEND_DECISION_LABELS_RU: Record<string, string> = {
  allowed: 'Разрешено',
  review_required: 'Нужна проверка',
  blocked: 'Заблокировано',
  rate_limited: 'Достигнут лимит',
  quiet_hours: 'Тихие часы',
  missing_metadata: 'Не хватает данных',
  unsafe_content: 'Небезопасное содержание',
  unknown_message_type: 'Неизвестный тип',
};

const DELIVERY_STATUS_LABELS_RU: Record<string, string> = {
  queued: 'В очереди',
  sending: 'Отправляется',
  sent: 'Отправлено',
  failed: 'Ошибка',
  skipped: 'Пропущено',
  blocked: 'Заблокировано',
  dry_run: 'Проверено без отправки',
};

function communicationAutoSendDecision(item: BookingOpsCommunicationIntent): {
  code: string;
  summary: string;
  actualSendEnabled: boolean;
} {
  const raw = item.metadata.auto_send_decision;
  if (!raw || typeof raw !== 'object') {
    return { code: 'review_required', summary: 'Классификация ещё не выполнена.', actualSendEnabled: false };
  }
  const value = raw as Record<string, unknown>;
  return {
    code: String(value.decision ?? 'review_required'),
    summary: String(value.safe_to_display_summary ?? 'Нужна проверка оператора.'),
    actualSendEnabled: value.actual_send_enabled === true,
  };
}

function communicationDelivery(item: BookingOpsCommunicationIntent) {
  const raw = item.metadata.auto_send_delivery;
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
}

type AutoSendScopeView = {
  scopeType: 'owner' | 'property' | 'booking' | 'pilot';
  scopeRef: string;
  actualSendEnabled: boolean;
  dryRunOnly: boolean;
  emergencyStop: boolean;
  maxBatchSize: number;
  enabledAt: string | null;
};

type AutoSendOperationalStatus = {
  ok: boolean;
  globalActualSendEnabled: boolean;
  emergencyStop: boolean;
  scopes: AutoSendScopeView[];
  lastRun: null | {
    dry_run?: boolean;
    status?: string;
    processed_count?: number;
    sent_count?: number;
    failed_count?: number;
    blocked_count?: number;
    started_at?: string;
    safe_summary?: string;
  };
  counts: { queued: number; sent: number; failed: number };
};

function AutoSendOperationsCard({
  record,
  isOpsAdmin,
  onMessage,
}: {
  record: BookingOpsRecord;
  isOpsAdmin: boolean;
  onMessage: (message: string) => void;
}) {
  const [status, setStatus] = useState<AutoSendOperationalStatus | null>(null);
  const [scopeType, setScopeType] = useState<AutoSendScopeView['scopeType']>('booking');
  const [scopeRef, setScopeRef] = useState(record.bookingId ?? record.id);
  const [dryRunOnly, setDryRunOnly] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!isOpsAdmin) return;
    const response = await fetch('/api/dashboard/booking-ops/communications/auto-send/scope/status', { credentials: 'include' });
    const payload = await readResponseJson<AutoSendOperationalStatus>(response, {
      ok: false,
      globalActualSendEnabled: false,
      emergencyStop: true,
      scopes: [],
      lastRun: null,
      counts: { queued: 0, sent: 0, failed: 0 },
    });
    if (response.ok && payload.ok) setStatus(payload);
  }, [isOpsAdmin]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (scopeType === 'booking') setScopeRef(record.bookingId ?? record.id);
    if (scopeType === 'property') setScopeRef(record.propertyId ?? '');
  }, [record.bookingId, record.id, record.propertyId, scopeType]);

  async function mutate(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await readResponseJson<{ ok: boolean; message?: string; summary?: string }>(response, { ok: false });
      onMessage(payload.message ?? payload.summary ?? (response.ok ? 'Действие выполнено.' : 'Действие не выполнено.'));
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  if (!isOpsAdmin) return null;
  const current = status?.scopes.find((scope) => scope.scopeType === scopeType && scope.scopeRef === scopeRef) ?? null;
  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-emerald-950">Безопасная автоотправка</h3>
          <p className="mt-1 text-xs text-emerald-900">Глобально: выключена. Работает только для явно включённых уровней.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 ${status?.emergencyStop ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
            {status?.emergencyStop ? 'Аварийная остановка' : 'Остановка снята'}
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-slate-700">
            {current?.actualSendEnabled ? (current.dryRunOnly ? 'Только проверка' : 'Включена') : 'Выключена'}
          </span>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-emerald-900">Управление и последний запуск</summary>
        <div className="mt-3 space-y-3 rounded-md border border-emerald-200 bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
            <select value={scopeType} onChange={(event) => setScopeType(event.target.value as AutoSendScopeView['scopeType'])} className="rounded border border-slate-300 px-2 py-1.5 text-xs">
              <option value="booking">Бронь</option><option value="property">Объект</option><option value="owner">Владелец</option><option value="pilot">Пилот / демо</option>
            </select>
            <input value={scopeRef} onChange={(event) => setScopeRef(event.target.value)} placeholder="ID уровня" className="rounded border border-slate-300 px-2 py-1.5 text-xs" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dryRunOnly} onChange={(event) => setDryRunOnly(event.target.checked)} />Только проверка</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !scopeRef.trim()} onClick={() => void mutate('/api/dashboard/booking-ops/communications/auto-send/scope/enable', { scopeType, scopeRef, dryRunOnly, maxBatchSize: 10, reason: 'Включено оператором для пилотного уровня.' })} className="rounded border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-800 disabled:opacity-50">Включить уровень</button>
            <button type="button" disabled={busy || !scopeRef.trim()} onClick={() => void mutate('/api/dashboard/booking-ops/communications/auto-send/scope/disable', { scopeType, scopeRef })} className="rounded border border-slate-300 px-2.5 py-1.5 text-xs disabled:opacity-50">Отключить</button>
            <button type="button" disabled={busy} onClick={() => void mutate('/api/dashboard/booking-ops/communications/auto-send/dry-run', { maxBatchSize: 10 })} className="rounded border border-sky-300 px-2.5 py-1.5 text-xs text-sky-800 disabled:opacity-50">Проверить очередь</button>
            <button type="button" disabled={busy} onClick={() => void mutate('/api/dashboard/booking-ops/communications/auto-send/execute', { maxBatchSize: 10 })} className="rounded border border-violet-300 px-2.5 py-1.5 text-xs text-violet-800 disabled:opacity-50">Запустить безопасную отправку</button>
            <button type="button" disabled={busy} onClick={() => void mutate('/api/dashboard/booking-ops/communications/auto-send/emergency-stop', { enabled: !status?.emergencyStop, reason: 'Изменено оператором.' })} className="rounded border border-rose-300 px-2.5 py-1.5 text-xs text-rose-800 disabled:opacity-50">{status?.emergencyStop ? 'Снять остановку' : 'Остановить всё'}</button>
          </div>
          <div className="grid gap-1 text-xs text-slate-600 sm:grid-cols-3">
            <span>В очереди: {status?.counts.queued ?? 0}</span><span>Отправлено: {status?.counts.sent ?? 0}</span><span>Ошибок: {status?.counts.failed ?? 0}</span>
          </div>
          <p className="text-xs text-slate-600">Последний запуск: {status?.lastRun?.started_at ? formatCommunicationAttemptTime(status.lastRun.started_at) : 'ещё не выполнялся'}. {status?.lastRun?.safe_summary ?? ''}</p>
        </div>
      </details>
    </section>
  );
}

function formatCommunicationAttemptTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'нет' : parsed.toLocaleString('ru-RU');
}

function CommunicationIntentsCard({
  communications,
  tasks,
  loading,
  isOpsAdmin,
  updatingCommunicationId,
  onAutoSendAction,
}: {
  communications: BookingOpsCommunicationIntent[];
  tasks: BookingOpsTask[];
  loading: boolean;
  isOpsAdmin: boolean;
  updatingCommunicationId: string | null;
  onAutoSendAction: (communicationId: string, action: CommunicationAutoSendAction) => void;
}) {
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const groups = useMemo(() => {
    const byActor = new Map<string, BookingOpsCommunicationIntent[]>();
    for (const item of communications) {
      const key = item.actorType;
      byActor.set(key, [...(byActor.get(key) ?? []), item]);
    }
    return [...byActor.entries()];
  }, [communications]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Коммуникации</h3>
          <p className="mt-1 text-xs text-slate-500">
            Черновики, решения и состояние безопасной отправки.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          {communications.length}
        </span>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Загрузка коммуникаций…</p>
      ) : communications.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          Коммуникации появятся после пересчёта задач и готовности.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map(([actorType, items]) => (
            <div key={actorType} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {BOOKING_OPS_COMMUNICATION_ACTOR_LABELS_RU[
                  actorType as keyof typeof BOOKING_OPS_COMMUNICATION_ACTOR_LABELS_RU
                ] ?? actorType}
              </p>
              <div className="mt-2 space-y-2">
                {items.map((item) => {
                  const task = item.relatedTaskId ? taskById.get(item.relatedTaskId) : null;
                  const autoSend = communicationAutoSendDecision(item);
                  const delivery = communicationDelivery(item);
                  const updating = updatingCommunicationId === item.id;
                  return (
                    <article
                      key={item.id}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {COMMUNICATION_PURPOSE_LABELS_RU[item.purpose] ?? item.purpose}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {BOOKING_OPS_COMMUNICATION_STATUS_LABELS_RU[item.status]}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>{COMMUNICATION_CHANNEL_LABELS_RU[item.channel] ?? item.channel}</span>
                        {task ? <span>Задача: {task.title}</span> : null}
                      </div>
                      <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-700">
                            Автоотправка: {AUTO_SEND_DECISION_LABELS_RU[autoSend.code] ?? 'Нужна проверка'}
                          </span>
                          <span className="text-slate-500">
                            Фактическая отправка: {autoSend.actualSendEnabled ? 'включена' : 'выключена'}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-600">{autoSend.summary}</p>
                        {delivery ? (
                          <div className="mt-2 grid gap-1 text-slate-600 sm:grid-cols-2">
                            <span>Доставка: {DELIVERY_STATUS_LABELS_RU[String(delivery.status ?? '')] ?? 'Нет'}</span>
                            <span>Попыток: {String(delivery.attemptCount ?? 0)}</span>
                            <span>Последняя попытка: {delivery.lastAttemptAt ? formatCommunicationAttemptTime(String(delivery.lastAttemptAt)) : 'нет'}</span>
                            <span>Ключ: {String(delivery.idempotencyKey ?? 'нет')}</span>
                            {delivery.failureReason ? <span className="sm:col-span-2">Причина: {String(delivery.failureReason)}</span> : null}
                          </div>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                        {formatBookingOpsMessageTextDisplay(item.messageText)}
                      </p>
                      {isOpsAdmin ? (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer font-medium text-slate-600">
                            {updating ? 'Сохранение…' : 'Действия автоотправки'}
                          </summary>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'run_dry_run')} className="rounded border border-sky-300 px-2 py-1 text-sky-700 disabled:opacity-50">
                              Проверить без отправки
                            </button>
                            <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'send_now')} className="rounded border border-emerald-300 px-2 py-1 text-emerald-700 disabled:opacity-50">
                              Отправить сейчас, если безопасно
                            </button>
                            <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'force_review')} className="rounded border border-amber-300 px-2 py-1 text-amber-700 disabled:opacity-50">
                              Нужна проверка
                            </button>
                            <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'block_auto_send')} className="rounded border border-rose-300 px-2 py-1 text-rose-700 disabled:opacity-50">
                              Заблокировать
                            </button>
                            <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'mark_safe_type')} className="rounded border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50">
                              Разрешить этот тип
                            </button>
                            <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'disable_booking')} className="rounded border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50">
                              Отключить для брони
                            </button>
                            {delivery?.status === 'failed' ? (
                              <button type="button" disabled={updating} onClick={() => onAutoSendAction(item.id, 'retry_failed')} className="rounded border border-violet-300 px-2 py-1 text-violet-700 disabled:opacity-50">
                                Повторить безопасную отправку
                              </button>
                            ) : null}
                          </div>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BookingOpsTimelineCard({
  events,
  loading,
}: {
  events: BookingOpsEvent[];
  loading: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Операционная история</h3>
        <span className="text-xs text-slate-500">Сначала новые</span>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Загрузка истории…</p>
      ) : events.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">История появится после следующего изменения.</p>
      ) : (
        <ol className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {events.map((event) => (
            <li key={event.id} className="relative border-l-2 border-slate-200 pl-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium text-slate-800">{event.title}</p>
                <time className="text-xs text-slate-500" dateTime={event.createdAt}>
                  {formatWhen(event.createdAt)}
                </time>
              </div>
              {event.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{event.description}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function GuestIntakeCard({
  session,
  isOpsAdmin,
  recomputing,
  onRecompute,
}: {
  session: BookingOpsGuestIntakeSession | null;
  isOpsAdmin: boolean;
  recomputing: boolean;
  onRecompute: () => void;
}) {
  const missing = session?.missingFields ?? [];
  const [copied, setCopied] = useState(false);
  const collected = Object.entries(session?.collectedFields ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([field]) => GUEST_INTAKE_FIELD_LABELS_RU[field] ?? field);

  async function copyLink() {
    if (!session?.publicIntakeUrl) return;
    try {
      await navigator.clipboard.writeText(session.publicIntakeUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Данные гостя</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
            {session ? BOOKING_OPS_GUEST_INTAKE_STATUS_LABELS_RU[session.intakeStatus] : 'Не начато'}
          </span>
          <button
            type="button"
            onClick={onRecompute}
            disabled={!isOpsAdmin || recomputing}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            {recomputing ? 'Пересчёт…' : 'Пересчитать данные гостя'}
          </button>
        </div>
      </div>
      {!session ? (
        <p className="mt-2 text-slate-600">Сбор данных появится после пересчёта подготовки.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {session.publicIntakeUrl ? (
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-700">Ссылка для гостя</p>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {copied ? 'Скопировано' : 'Скопировать ссылку гостю'}
                </button>
              </div>
              <p className="mt-1 break-all text-xs text-slate-600">{session.publicIntakeUrl}</p>
            </div>
          ) : null}
          {missing.length > 0 ? (
            <div>
              <p className="font-medium text-slate-700">Не хватает</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missing.map((field) => (
                  <span
                    key={field}
                    className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs text-amber-900"
                  >
                    {GUEST_INTAKE_FIELD_LABELS_RU[field] ?? field}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-emerald-800">Обязательные данные собраны.</p>
          )}
          {collected.length > 0 ? (
            <div>
              <p className="font-medium text-slate-700">Получено</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {collected.map((field) => (
                  <span
                    key={field}
                    className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs text-emerald-900"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {session.validationErrors.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-amber-900">
              <p className="font-medium">Ошибки проверки</p>
              <ul className="mt-1 list-disc pl-5">
                {session.validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-2">
            <p>
              Канал:{' '}
              {session.channel === 'telegram'
                ? 'Telegram'
                : session.channel === 'web'
                  ? 'Веб'
                  : 'Ручной'}
            </p>
            <p>Активность: {formatWhen(session.lastGuestActivityAt ?? session.updatedAt)}</p>
            <p>Ссылка открыта: {formatWhen(session.tokenOpenedAt)}</p>
          </div>
          {session.fallbackReason ? (
            <p className="rounded-md border border-rose-200 bg-white px-3 py-2 text-rose-900">
              {session.fallbackReason}
            </p>
          ) : null}
          {session.generatedMessage ? (
            <div>
              <p className="font-medium text-slate-700">Сообщение гостю</p>
              <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-700">
                {session.generatedMessage}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReadinessCard({
  readiness,
}: {
  readiness: NonNullable<BookingOpsRecord['readiness']>;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm space-y-3 ${
        READINESS_TONE[readiness.status]
      }`}
    >
      <div>
        <p className="font-semibold">
          Готовность: {BOOKING_READINESS_STATUS_LABELS_RU[readiness.status]}
        </p>
        {readiness.missingItems.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 space-y-1">
            {readiness.missingItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">Обязательные шаги до черновиков Telegram выполнены.</p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {readiness.checklist.map((group) => (
          <div key={group.id} className="rounded-md border border-white/60 bg-white/70 px-3 py-2">
            <p className="font-medium text-slate-900">{group.title}</p>
            <ul className="mt-2 space-y-1 text-xs">
              {group.items.map((item) => (
                <li key={item.id} className={item.ok ? 'text-emerald-800' : 'text-amber-900'}>
                  {item.ok ? '✓' : '○'} {item.label}
                  {item.detail && !item.ok ? ` — ${item.detail}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

const OPS_TASK_STATUS_TONE: Record<BookingOpsTaskStatus, string> = {
  open: 'border-amber-200 bg-amber-50 text-amber-950',
  in_progress: 'border-sky-200 bg-sky-50 text-sky-950',
  blocked: 'border-red-200 bg-red-50 text-red-950',
  completed: 'border-slate-200 bg-slate-50 text-slate-600',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-500',
};

const UNIT_READINESS_TONE: Record<string, string> = {
  not_ready: 'border-slate-200 bg-slate-50 text-slate-700',
  cleaning_pending: 'border-amber-200 bg-amber-50 text-amber-950',
  linen_pending: 'border-sky-200 bg-sky-50 text-sky-950',
  inspection_pending: 'border-violet-200 bg-violet-50 text-violet-950',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  blocked: 'border-red-200 bg-red-50 text-red-950',
};

function TurnoverOpsCard({
  record,
  tasks,
  loading,
  isOpsAdmin,
  updatingTaskId,
  runningTaskId,
  recomputing,
  taskActionResults,
  onUpdateStatus,
  onRunAction,
  onRecompute,
}: {
  record: BookingOpsRecord;
  tasks: BookingOpsTask[];
  loading: boolean;
  isOpsAdmin: boolean;
  updatingTaskId: string | null;
  runningTaskId: string | null;
  recomputing: boolean;
  taskActionResults: Record<string, TaskActionResult>;
  onUpdateStatus: (taskId: string, status: BookingOpsTaskStatus) => void;
  onRunAction: (taskId: string) => void;
  onRecompute: () => void;
}) {
  const turnoverTasks = tasks.filter((task) => isTurnoverTaskType(task.taskType));
  const unitStatus = computeUnitReadinessStatus(record, tasks);
  const preparation = planBookingOpsPreparation(record, tasks);
  const openTurnover = turnoverTasks.filter(
    (task) => task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked',
  );
  const showCard = Boolean(record.checkInAt && record.checkOutAt) || turnoverTasks.length > 0;

  if (!showCard) return null;

  return (
    <section className="rounded-lg border border-teal-200 bg-teal-50/50 px-4 py-3 text-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-teal-950">Подготовка объекта</h3>
          <p className="mt-1 text-xs leading-relaxed text-teal-900/90">
            Уборка, бельё, осмотр, расходники, заявки мастеру и готовность к следующему заезду.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOpsAdmin ? (
            <button
              type="button"
              disabled={recomputing}
              onClick={onRecompute}
              className="rounded border border-teal-400 bg-white px-2.5 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
            >
              {recomputing ? 'Пересчитываем…' : 'Пересчитать подготовку'}
            </button>
          ) : null}
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              UNIT_READINESS_TONE[unitStatus] ?? UNIT_READINESS_TONE.not_ready
            }`}
          >
            {BOOKING_OPS_UNIT_READINESS_STATUS_LABELS_RU[unitStatus]}
          </span>
        </div>
      </div>

      <div className="rounded-md border border-teal-200 bg-white/80 px-3 py-2">
        <p className="text-xs font-medium text-teal-950">Следующее действие: {preparation.nextAction}</p>
        <p className="mt-1 text-[11px] text-teal-800">
          План и статус готовности пересчитываются внутри Booking Ops.
        </p>
      </div>

      {loading ? <p className="text-xs text-teal-800">Загрузка задач…</p> : null}

      {!loading && turnoverTasks.length === 0 ? (
        <p className="text-xs text-teal-900">
          Задачи уборки появятся после завершения ручной отправки черновиков и подтверждения выезда.
        </p>
      ) : null}

      {openTurnover.length > 0 ? (
        <ul className="space-y-2">
          {openTurnover.map((task) => {
            const actionResult = taskActionResults[task.id];
            const actionLabel =
              BOOKING_OPS_TASK_ACTION_LABELS_RU[task.taskType] ?? 'Выполнить действие';
            return (
              <li
                key={task.id}
                id={`booking-ops-task-${task.id}`}
                className={`rounded-md border px-3 py-2 ${OPS_TASK_STATUS_TONE[task.status]}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{task.title}</p>
                    {task.source === 'system' ? (
                      <span className="mt-1 inline-flex rounded-full border border-teal-300 bg-white px-2 py-0.5 text-[10px] font-medium text-teal-800">
                        Создано автоматически
                      </span>
                    ) : null}
                    {task.description ? <p className="mt-1 text-xs">{task.description}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isOpsAdmin ? (
                      <button
                        type="button"
                        disabled={runningTaskId === task.id || updatingTaskId === task.id}
                        onClick={() => onRunAction(task.id)}
                        className="rounded border border-teal-400 bg-white px-2 py-1 text-xs font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
                      >
                        {runningTaskId === task.id ? 'Выполняется…' : actionLabel}
                      </button>
                    ) : null}
                    {isOpsAdmin ? (
                      <select
                        value={task.status}
                        disabled={updatingTaskId === task.id}
                        onChange={(event) =>
                          onUpdateStatus(task.id, event.target.value as BookingOpsTaskStatus)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {BOOKING_OPS_TASK_STATUSES.filter((status) => status !== 'cancelled').map(
                          (status) => (
                            <option key={status} value={status}>
                              {BOOKING_OPS_TASK_STATUS_LABELS_RU[status]}
                            </option>
                          ),
                        )}
                      </select>
                    ) : null}
                  </div>
                </div>
                {actionResult?.checklist && actionResult.checklist.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-xs space-y-0.5">
                    {actionResult.checklist.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : turnoverTasks.length > 0 ? (
        <p className="text-xs text-emerald-800">Все задачи подготовки объекта выполнены.</p>
      ) : null}

      <p className="text-[11px] text-teal-800/80">
        Черновики и чеклисты только для внутреннего использования. Telegram и email не отправляются.
      </p>
    </section>
  );
}

function OperationalTasksCard({
  tasks,
  loading,
  isOpsAdmin,
  updatingTaskId,
  runningTaskId,
  taskActionResults,
  onUpdateStatus,
  onRunAction,
}: {
  tasks: BookingOpsTask[];
  loading: boolean;
  isOpsAdmin: boolean;
  updatingTaskId: string | null;
  runningTaskId: string | null;
  taskActionResults: Record<string, TaskActionResult>;
  onUpdateStatus: (taskId: string, status: BookingOpsTaskStatus) => void;
  onRunAction: (taskId: string) => void;
}) {
  const openTasks = tasks.filter((task) =>
    task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked',
  );
  const completedTasks = tasks.filter((task) =>
    task.status === 'completed' || task.status === 'cancelled',
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Операционные задачи</h3>
        {loading ? <span className="text-xs text-slate-500">Загрузка…</span> : null}
      </div>

      {openTasks.length === 0 && !loading ? (
        <p className="text-slate-600">Нет открытых задач — все шаги выполнены или ещё не созданы.</p>
      ) : null}

      {openTasks.length > 0 ? (
        <ul className="space-y-2">
          {openTasks.map((task) => {
            const actionResult = taskActionResults[task.id];
            const actionLabel =
              BOOKING_OPS_TASK_ACTION_LABELS_RU[task.taskType] ?? 'Выполнить действие';
            return (
            <li
              key={task.id}
              id={`booking-ops-task-${task.id}`}
              className={`rounded-md border px-3 py-2 ${OPS_TASK_STATUS_TONE[task.status]}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{task.title}</p>
                  {task.description ? <p className="mt-1 text-xs">{task.description}</p> : null}
                  <p className="mt-1 text-xs opacity-80">
                    {BOOKING_OPS_TASK_STATUS_LABELS_RU[task.status]}
                    {task.source !== 'system'
                      ? ` · ${BOOKING_OPS_TASK_SOURCE_LABELS_RU[task.source]}`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isOpsAdmin ? (
                    <button
                      type="button"
                      disabled={runningTaskId === task.id || updatingTaskId === task.id}
                      onClick={() => onRunAction(task.id)}
                      className="rounded border border-slate-400 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {runningTaskId === task.id ? 'Выполняется…' : actionLabel}
                    </button>
                  ) : null}
                  {isOpsAdmin ? (
                    <select
                      value={task.status}
                      disabled={updatingTaskId === task.id}
                      onChange={(event) =>
                        onUpdateStatus(task.id, event.target.value as BookingOpsTaskStatus)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      {BOOKING_OPS_TASK_STATUSES.filter((status) => status !== 'cancelled').map(
                        (status) => (
                          <option key={status} value={status}>
                            {BOOKING_OPS_TASK_STATUS_LABELS_RU[status]}
                          </option>
                        ),
                      )}
                    </select>
                  ) : null}
                </div>
              </div>
              {actionResult ? (
                <div
                  className={`mt-2 rounded border px-2 py-2 text-xs ${
                    actionResult.ok
                      ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
                      : 'border-amber-200 bg-amber-50/80 text-amber-950'
                  }`}
                >
                  <p>{actionResult.message}</p>
                  {actionResult.blockingReason ? (
                    <p className="mt-1 opacity-90">Причина блокировки: {actionResult.blockingReason}</p>
                  ) : null}
                  {actionResult.nextTaskStatusSuggestion ? (
                    <p className="mt-1 opacity-80">
                      Рекомендуемый статус:{' '}
                      {BOOKING_OPS_TASK_STATUS_LABELS_RU[actionResult.nextTaskStatusSuggestion]}
                    </p>
                  ) : null}
                  {actionResult.checklist && actionResult.checklist.length > 0 ? (
                    <ul className="mt-2 list-disc pl-4 space-y-0.5">
                      {actionResult.checklist.map((item, index) => (
                        <li key={`${task.id}-check-${index}`} className="whitespace-pre-wrap">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {actionResult.createdDraftIds && actionResult.createdDraftIds.length > 0 ? (
                    <p className="mt-1 opacity-80">
                      Черновики: {actionResult.createdDraftIds.join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
            );
          })}
        </ul>
      ) : null}

      {completedTasks.length > 0 ? (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Выполненные и отменённые ({completedTasks.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {completedTasks.map((task) => (
              <li key={task.id} className="rounded border border-slate-100 px-2 py-1">
                {task.title} — {BOOKING_OPS_TASK_STATUS_LABELS_RU[task.status]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function IntakeFields({
  draft,
  onChange,
}: {
  draft: EditDraft;
  onChange: (value: EditDraft) => void;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Чеклист приёма брони</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Количество гостей</span>
          <input
            type="number"
            min={1}
            value={draft.guestCount}
            onChange={(event) => onChange({ ...draft, guestCount: event.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Статус оплаты</span>
          <input
            value={draft.paymentStatus}
            onChange={(event) => onChange({ ...draft, paymentStatus: event.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <TriStateSelect
          label="Документы требуются"
          value={draft.documentRequired}
          onChange={(value) => onChange({ ...draft, documentRequired: value })}
        />
        <TriStateSelect
          label="Документы получены"
          value={draft.documentCollected}
          onChange={(value) => onChange({ ...draft, documentCollected: value })}
        />
        <OptionalStatusSelect
          label="Проверка документов"
          value={draft.documentVerificationStatus}
          options={BOOKING_OPS_DOCUMENT_VERIFICATION_STATUSES}
          labels={BOOKING_OPS_DOCUMENT_VERIFICATION_STATUS_LABELS_RU}
          onChange={(value) => onChange({ ...draft, documentVerificationStatus: value })}
        />
        <TriStateSelect
          label="Договор требуется"
          value={draft.contractRequired}
          onChange={(value) => onChange({ ...draft, contractRequired: value })}
        />
        <OptionalStatusSelect
          label="Провайдер договора"
          value={draft.contractProvider}
          options={BOOKING_OPS_CONTRACT_PROVIDERS}
          labels={BOOKING_OPS_CONTRACT_PROVIDER_LABELS_RU}
          onChange={(value) => onChange({ ...draft, contractProvider: value })}
        />
        <OptionalStatusSelect
          label="Статус договора (intake)"
          value={draft.contractIntakeStatus}
          options={BOOKING_OPS_CONTRACT_INTAKE_STATUSES}
          labels={BOOKING_OPS_CONTRACT_INTAKE_STATUS_LABELS_RU}
          onChange={(value) => onChange({ ...draft, contractIntakeStatus: value })}
        />
        <label className="block text-sm md:col-span-2">
          <span className="font-medium text-slate-700">Ссылка на договор</span>
          <input
            value={draft.contractLink}
            onChange={(event) => onChange({ ...draft, contractLink: event.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <TriStateSelect
          label="Депозит требуется"
          value={draft.depositRequired}
          onChange={(value) => onChange({ ...draft, depositRequired: value })}
        />
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Сумма депозита</span>
          <input
            type="number"
            min={0}
            value={draft.depositAmount}
            onChange={(event) => onChange({ ...draft, depositAmount: event.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <OptionalStatusSelect
          label="Статус депозита (intake)"
          value={draft.depositIntakeStatus}
          options={BOOKING_OPS_DEPOSIT_INTAKE_STATUSES}
          labels={BOOKING_OPS_DEPOSIT_INTAKE_STATUS_LABELS_RU}
          onChange={(value) => onChange({ ...draft, depositIntakeStatus: value })}
        />
        <TriStateSelect
          label="МВД требуется"
          value={draft.mvdRequired}
          onChange={(value) => onChange({ ...draft, mvdRequired: value })}
        />
        <OptionalStatusSelect
          label="Статус данных МВД"
          value={draft.mvdDataStatus}
          options={BOOKING_OPS_MVD_DATA_STATUSES}
          labels={BOOKING_OPS_MVD_DATA_STATUS_LABELS_RU}
          onChange={(value) => onChange({ ...draft, mvdDataStatus: value })}
        />
        <label className="block text-sm md:col-span-2">
          <span className="font-medium text-slate-700">Подтверждение МВД / ссылка</span>
          <input
            value={draft.mvdConfirmationLink}
            onChange={(event) => onChange({ ...draft, mvdConfirmationLink: event.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      </div>
    </div>
  );
}

function TriStateSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: '' | 'true' | 'false';
  onChange: (value: '' | 'true' | 'false') => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as '' | 'true' | 'false')}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      >
        <option value="">Не указано</option>
        <option value="true">Да</option>
        <option value="false">Нет</option>
      </select>
    </label>
  );
}

function OptionalStatusSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: '' | T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: '' | T) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as '' | T)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      >
        <option value="">Не указано</option>
        {options.map((item) => (
          <option key={item} value={item}>
            {labels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}

function OperatorActionPanel({
  action,
  confirming,
  creatingTelegramDraft,
  telegramDraftsLoading,
  telegramDraft,
  onConfirm,
  onCreateTelegramDraft,
  onCopyTelegramDraft,
}: {
  action: BookingOpsActionTemplate;
  confirming: boolean;
  creatingTelegramDraft: boolean;
  telegramDraftsLoading: boolean;
  telegramDraft: BookingOpsTelegramDraft | null;
  onConfirm: () => void;
  onCreateTelegramDraft: () => void;
  onCopyTelegramDraft: (draft: BookingOpsTelegramDraft) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [draftCopied, setDraftCopied] = useState(false);
  const supportsTelegramDraft = (
    BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS as readonly string[]
  ).includes(action.actionId);
  const guestMessageText = action.messageTemplate
    ? formatBookingOpsMessageTextDisplay(action.messageTemplate)
    : null;

  async function copyMessage() {
    if (!guestMessageText) return;
    try {
      await navigator.clipboard.writeText(guestMessageText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function copyDraft() {
    if (!telegramDraft) return;
    try {
      await onCopyTelegramDraft(telegramDraft);
      setDraftCopied(true);
      window.setTimeout(() => setDraftCopied(false), 2000);
    } catch {
      setDraftCopied(false);
    }
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm space-y-3 ${
        action.isAllowed
          ? 'border-indigo-200 bg-indigo-50 text-indigo-950'
          : 'border-slate-200 bg-slate-50 text-slate-700'
      }`}
    >
      <div>
        <p className="font-semibold text-base">{action.title}</p>
        <p className="mt-1">{action.description}</p>
      </div>

      {!action.isAllowed && action.blockedReason ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">
          {action.blockedReason}
        </p>
      ) : null}

      {action.warnings.length > 0 ? (
        <ul className="list-disc pl-5 space-y-1 text-amber-900">
          {action.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {action.internalChecklist.length > 0 ? (
        <div>
          <p className="font-medium">Чеклист оператора</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {action.internalChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {guestMessageText ? (
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Текст для гостя</p>
            <button
              type="button"
              onClick={() => void copyMessage()}
              className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-900 hover:bg-indigo-100"
            >
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-indigo-200 bg-white px-3 py-2 text-xs leading-relaxed">
            {guestMessageText}
          </pre>
        </div>
      ) : null}

      {supportsTelegramDraft && guestMessageText ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sky-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">Черновик Telegram</p>
              <p className="mt-1 text-xs">Создаётся только для проверки и ручной отправки.</p>
            </div>
            {telegramDraft ? (
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium">
                {BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU[telegramDraft.status]}
              </span>
            ) : null}
          </div>

          {telegramDraftsLoading ? (
            <p className="mt-3 text-xs">Загрузка черновика…</p>
          ) : telegramDraft ? (
            <div className="mt-3 space-y-2">
              {telegramDraft.warning ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  {telegramDraft.warning}
                </p>
              ) : (
                <p className="text-xs">
                  Чат получателя найден: {telegramDraft.telegramTarget ?? telegramDraft.telegramChatId}
                </p>
              )}
              <pre className="whitespace-pre-wrap rounded-md border border-sky-200 bg-white px-3 py-2 text-xs leading-relaxed">
                {formatBookingOpsMessageTextDisplay(telegramDraft.messageText)}
              </pre>
              <button
                type="button"
                onClick={() => void copyDraft()}
                className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-sky-100"
              >
                {draftCopied ? 'Скопировано' : 'Копировать черновик'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onCreateTelegramDraft}
              disabled={!action.isAllowed || creatingTelegramDraft}
              className="mt-3 rounded-md bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-60"
            >
              {creatingTelegramDraft ? 'Создание…' : 'Создать черновик Telegram'}
            </button>
          )}
        </div>
      ) : null}

      {action.isAllowed ? (
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-60"
        >
          {confirming ? 'Сохранение…' : 'Подтвердить выполнение'}
        </button>
      ) : null}
    </div>
  );
}

function RecordFields({
  draft,
  onChange,
}: {
  draft: EditDraft;
  onChange: (value: EditDraft) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Имя гостя</span>
        <input
          required
          value={draft.guestName}
          onChange={(event) => onChange({ ...draft, guestName: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Телефон</span>
        <input
          value={draft.guestPhone}
          onChange={(event) => onChange({ ...draft, guestPhone: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">E-mail</span>
        <input
          value={draft.guestEmail}
          onChange={(event) => onChange({ ...draft, guestEmail: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Telegram</span>
        <input
          value={draft.guestTelegram}
          onChange={(event) => onChange({ ...draft, guestTelegram: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Объект (ID)</span>
        <input
          value={draft.propertyId}
          onChange={(event) => onChange({ ...draft, propertyId: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Объект (название)</span>
        <input
          value={draft.propertyLabel}
          onChange={(event) => onChange({ ...draft, propertyLabel: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Источник / OTA</span>
        <input
          value={draft.otaSource}
          onChange={(event) => onChange({ ...draft, otaSource: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Статус контура</span>
        <select
          value={draft.opsStatus}
          onChange={(event) => onChange({ ...draft, opsStatus: event.target.value as BookingOpsStatus })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        >
          {BOOKING_OPS_STATUSES.map((item) => (
            <option key={item} value={item}>
              {BOOKING_OPS_STATUS_LABELS_RU[item]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Заезд</span>
        <input
          type="date"
          value={draft.checkInAt}
          onChange={(event) => onChange({ ...draft, checkInAt: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Выезд</span>
        <input
          type="date"
          value={draft.checkOutAt}
          onChange={(event) => onChange({ ...draft, checkOutAt: event.target.value })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        />
      </label>
      <StatusSelect
        label="Документы"
        value={draft.documentsStatus}
        options={BOOKING_OPS_DOCUMENTS_STATUSES}
        labels={BOOKING_OPS_DOCUMENTS_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, documentsStatus: value })}
      />
      <StatusSelect
        label="Договор"
        value={draft.contractStatus}
        options={BOOKING_OPS_CONTRACT_STATUSES}
        labels={BOOKING_OPS_CONTRACT_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, contractStatus: value })}
      />
      <StatusSelect
        label="Депозит"
        value={draft.depositStatus}
        options={BOOKING_OPS_DEPOSIT_STATUSES}
        labels={BOOKING_OPS_DEPOSIT_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, depositStatus: value })}
      />
      <StatusSelect
        label="МВД"
        value={draft.mvdStatus}
        options={BOOKING_OPS_MVD_STATUSES}
        labels={BOOKING_OPS_MVD_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, mvdStatus: value })}
      />
      <StatusSelect
        label="Готовность к заезду"
        value={draft.checkinReadinessStatus}
        options={BOOKING_OPS_CHECKIN_READINESS_STATUSES}
        labels={BOOKING_OPS_CHECKIN_READINESS_STATUS_LABELS_RU}
        onChange={(value) => onChange({ ...draft, checkinReadinessStatus: value })}
      />
    </div>
  );
}

function StatusSelect<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      >
        {options.map((item) => (
          <option key={item} value={item}>
            {labels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function BookingOpsPage() {
  return (
    <CrmAccessGuard>
      <BookingOpsPageInner />
    </CrmAccessGuard>
  );
}
