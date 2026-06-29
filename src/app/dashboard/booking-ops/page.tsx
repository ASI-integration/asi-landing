'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';
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
  BOOKING_OPS_TELEGRAM_DRAFT_ACTIONS,
  BOOKING_OPS_TELEGRAM_DRAFT_STATUS_LABELS_RU,
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
} from '@/lib/booking-ops/types';
import {
  BOOKING_OPS_TASK_STATUS_LABELS_RU,
  BOOKING_OPS_TASK_STATUSES,
  BOOKING_OPS_TASK_ACTION_LABELS_RU,
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

type ListResponse = {
  ok: boolean;
  message?: string;
  records: BookingOpsRecord[];
  isOpsAdmin?: boolean;
  refreshedAt?: string;
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
    guestName: record.guestName ?? '',
    guestPhone: record.guestPhone ?? '',
    guestEmail: record.guestEmail ?? '',
    guestTelegram: record.guestTelegram ?? '',
    propertyId: record.propertyId ?? '',
    propertyLabel: record.propertyLabel ?? '',
    otaSource: record.otaSource ?? '',
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
    notes: record.notes ?? '',
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
  const [timelineEvents, setTimelineEvents] = useState<BookingOpsEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [taskActionResults, setTaskActionResults] = useState<Record<string, TaskActionResult>>({});
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
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
      const res = await fetch('/api/dashboard/booking-ops', { credentials: 'include' });
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
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  function selectRecord(record: BookingOpsRecord) {
    setSelectedId(record.id);
    setDraft(draftFromRecord(record));
    setTelegramDrafts([]);
    setOpsTasks([]);
    setTimelineEvents([]);
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
      await Promise.all([reloadOpsTasks(selectedId), reloadTimeline(selectedId)]);
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

  async function reloadTimeline(recordId: string) {
    const res = await fetch(`/api/dashboard/booking-ops/${recordId}/events`, {
      credentials: 'include',
    });
    const payload = await readResponseJson<TimelineResponse>(res, { ok: false });
    if (res.ok && payload.ok) setTimelineEvents(payload.events ?? []);
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
        reloadTelegramDrafts(selectedId),
        reloadTimeline(selectedId),
      ]);
    } finally {
      setUpdatingTaskId(null);
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
      await Promise.all([reloadOpsTasks(selectedId), reloadTimeline(selectedId)]);
      setMessage('Черновик Telegram создан. Сообщение не отправлено.');
    } finally {
      setCreatingTelegramDraft(false);
    }
  }

  async function onCopyTelegramDraft(draft: BookingOpsTelegramDraft) {
    await navigator.clipboard.writeText(draft.messageText);
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
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!isOpsAdmin || !selectedId || !draft) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/dashboard/booking-ops/${selectedId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestName: draft.guestName,
          guestPhone: draft.guestPhone,
          guestEmail: draft.guestEmail,
          guestTelegram: draft.guestTelegram,
          propertyId: draft.propertyId,
          propertyLabel: draft.propertyLabel,
          otaSource: draft.otaSource,
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
          notes: draft.notes,
        }),
      });
      const payload = await readResponseJson<SaveResponse>(res, { ok: false });
      if (!res.ok || !payload.ok || !payload.record) {
        setMessage(payload.message || 'Не удалось сохранить изменения.');
        return;
      }
      setRecords((prev) => prev.map((item) => (item.id === payload.record!.id ? payload.record! : item)));
      setDraft(draftFromRecord(payload.record));
      await Promise.all([reloadOpsTasks(selectedId), reloadTimeline(selectedId)]);
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
      setMessage('Действие подтверждено, статус обновлён.');
    } finally {
      setConfirmingAction(false);
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
                      className={`border-t border-slate-100 cursor-pointer ${isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                      onClick={() => selectRecord(record)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{record.guestName || '—'}</div>
                        <div className="text-slate-500">{record.propertyLabel || record.propertyId || '—'}</div>
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

          {selectedRecord && draft && isOpsAdmin ? (
            <form onSubmit={onSave} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Редактирование</h2>
                  {selectedRecord.bookingId ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Создано из брони · ID: {selectedRecord.bookingId}
                      {selectedRecord.otaSource ? ` · ${selectedRecord.otaSource}` : ''}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">Обновлено: {formatWhen(selectedRecord.updatedAt)}</span>
              </div>

              {operatorGuidance ? (
                <OperatorGuidanceCard guidance={operatorGuidance} tasks={opsTasks} />
              ) : null}

              {selectedRecord.readiness ? (
                <ReadinessCard readiness={selectedRecord.readiness} />
              ) : null}

              <BookingOpsTimelineCard events={timelineEvents} loading={timelineLoading} />

              <OperationalTasksCard
                tasks={opsTasks}
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

              {selectedRecord.operatorAction ? (
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
          ) : selectedRecord ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
              Выберите запись для просмотра. Редактирование доступно администратору OPS.
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
                    {task.source === 'readiness_gate' ? ' · из готовности' : ''}
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

  async function copyMessage() {
    if (!action.messageTemplate) return;
    try {
      await navigator.clipboard.writeText(action.messageTemplate);
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

      {action.messageTemplate ? (
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
            {action.messageTemplate}
          </pre>
        </div>
      ) : null}

      {supportsTelegramDraft && action.messageTemplate ? (
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
                {telegramDraft.messageText}
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
        <span className="font-medium text-slate-700">Email</span>
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
