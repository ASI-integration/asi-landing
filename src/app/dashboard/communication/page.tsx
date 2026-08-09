'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  COMMUNICATION_CHANNEL_FOUNDATION,
  getCommunicationChannelFoundation,
} from '@/lib/communication/channel-foundation';

type ReviewStatus = 'pending' | 'acknowledged' | 'approved' | 'replied' | 'closed';
type Channel = 'telegram' | 'vk' | 'email' | 'max' | 'phone' | string;
type QuickFilter =
  | 'all'
  | 'requires_operator'
  | 'urgent'
  | 'waiting_for_guest'
  | 'ai_autopilot'
  | 'manual'
  | 'telegram'
  | 'vk'
  | 'email'
  | 'max'
  | 'phone'
  | 'closed';
type ReplyState = 'idle' | 'sending' | 'saved' | 'error';

type EscalationReview = {
  reviewId: string;
  sessionId: string;
  channel: Channel;
  targetId: string;
  reservationId?: string;
  propertyId?: string;
  leadId?: string;
  escalationReason: string;
  confidence?: number;
  suggestedReply?: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  latestMessages: Array<{
    direction: 'inbound' | 'outbound';
    content: string;
    createdAt: string;
  }>;
  source?: Record<string, unknown>;
};

type PhoneReviewSource = {
  source?: string;
  provider?: string;
  providerCallId?: string;
  callerPhoneNumber?: string | null;
  calledNumber?: string | null;
  eventType?: string;
  callStatus?: string;
  timestamp?: string;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  transcriptText?: string | null;
  transcriptProcessed?: boolean;
  orchestratorOutcome?: string | null;
  orchestratorEscalationReason?: string | null;
};

type ListResponse = {
  ok: boolean;
  reviews: EscalationReview[];
};

type GuestMemoryView = {
  profile: {
    preferredLanguage: 'ru' | 'en' | null;
    preferredCommunicationMode: 'text' | 'voice' | null;
    stayCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    lastStayAt: string | null;
  } | null;
  preferences: Array<{
    id: string;
    key: string;
    value: string;
    updatedAt: string;
  }>;
  events: Array<{
    id: string;
    type: string;
    summary: string;
    occurredAt: string;
    historyOnly: boolean;
  }>;
};

type GuestLifecycleVisibility = {
  reservationId: string;
  guest: string;
  currentStage: string;
  mostRecentEvent: string;
  mostRecentEventAt: string;
  mostRecentCommunication: string | null;
  pendingScheduledCommunication: { eventType: string; scheduledFor: string } | null;
  deliveryStatus: string;
  operatorActionRequired: boolean;
};

type FilterStatus = 'all' | ReviewStatus;
type FilterUrgency = 'all' | 'urgent' | 'normal';

type ChannelReadinessCard = {
  channel: 'telegram' | 'email' | 'phone';
  title: string;
  badge: string;
  summary: string;
  points: string[];
  countLabel: string;
  count: number;
  tone: 'primary' | 'foundation' | 'planned';
};

type CommunicationPathCard = {
  title: string;
  badge: string;
  summary: string;
  steps: string[];
};

function isUrgentReview(review: EscalationReview): boolean {
  const reason = review.escalationReason.toLowerCase();
  const phone = phoneSource(review);
  const phoneUrgent =
    phone?.eventType === 'call_escalated_to_operator' ||
    String(phone?.orchestratorEscalationReason ?? '').toLowerCase().includes('urgent');
  return reason.includes('urgent') || reason.includes('access') || reason.includes('emergency') || phoneUrgent;
}

function isClosedReview(review: EscalationReview): boolean {
  return review.status === 'closed';
}

function isWaitingForGuest(review: EscalationReview): boolean {
  return review.status === 'replied';
}

function isManualMode(review: EscalationReview): boolean {
  return review.status === 'acknowledged' || review.status === 'approved';
}

function isAiAutopilotInferred(review: EscalationReview): boolean {
  return review.status === 'closed' || review.status === 'replied';
}

function isRequiresOperator(review: EscalationReview): boolean {
  return review.status === 'pending' || review.status === 'acknowledged' || review.status === 'approved';
}

function shortTs(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { hour12: false });
}

function preferenceLabel(key: string): string {
  const labels: Record<string, string> = {
    quiet_room: 'Тихое размещение',
    parking: 'Парковка',
    late_checkout: 'Поздний выезд',
    accessibility: 'Доступность',
    crib: 'Детская кроватка',
    pet: 'Размещение с животным',
  };
  return labels[key] ?? 'Предпочтение';
}

function memoryEventLabel(type: string): string {
  const labels: Record<string, string> = {
    completed_stay: 'Завершённое проживание',
    booking_verified: 'Подтверждённая бронь',
    maintenance_resolution: 'Решение по ремонту',
    operator_confirmed_resolution: 'Решение оператора',
    refund_outcome: 'Итог по возврату',
    access_incident: 'Ситуация с доступом',
    house_rule_violation: 'Нарушение правил',
    late_checkout_history: 'История позднего выезда',
  };
  return labels[type] ?? 'Важное событие';
}

function lifecycleStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    reservation: 'Бронирование',
    arrival: 'Подготовка к заезду',
    checkin: 'Заезд',
    stay: 'Проживание',
    checkout: 'Выезд',
    completed: 'Завершено',
    cancelled: 'Отменено',
    incident: 'Обращение',
  };
  return labels[stage] ?? stage;
}

function lifecycleDeliveryLabel(status: string): string {
  const labels: Record<string, string> = {
    received: 'Получено',
    scheduled: 'Запланировано',
    processing: 'Обрабатывается',
    sent: 'Отправлено',
    dry_run: 'Без отправки',
    completed: 'Завершено',
    skipped: 'Пропущено',
    blocked: 'Заблокировано',
    operator_required: 'Нужен оператор',
    failed: 'Ошибка',
  };
  return labels[status] ?? status;
}

function isReturningGuestProfile(profile: GuestMemoryView['profile']): boolean {
  if (!profile) return false;
  const firstSeen = Date.parse(profile.firstSeenAt);
  const lastSeen = Date.parse(profile.lastSeenAt);
  return profile.stayCount > 0 || (
    Number.isFinite(firstSeen) &&
    Number.isFinite(lastSeen) &&
    lastSeen - firstSeen >= 24 * 60 * 60 * 1_000
  );
}

function channelLabel(channel: Channel): string {
  const foundation = getCommunicationChannelFoundation(channel);
  if (foundation) return foundation.labelRu;
  if (channel === 'telegram') return 'Telegram';
  if (channel === 'vk') return 'VK';
  if (channel === 'email') return 'Email';
  if (channel === 'max') return 'MAX';
  return channel;
}

function statusLabel(status: ReviewStatus): string {
  if (status === 'pending') return 'Ждёт оператора';
  if (status === 'acknowledged') return 'Взято в работу';
  if (status === 'approved') return 'Черновик принят';
  if (status === 'replied') return 'Ответ отправлен';
  return 'Закрыто';
}

function phoneSource(review: EscalationReview): PhoneReviewSource | null {
  if (review.channel !== 'phone') return null;
  const source = review.source as PhoneReviewSource | undefined;
  if (!source || source.source !== 'phone_call') return null;
  return source;
}

function phoneStatusLabel(source: PhoneReviewSource | null): string {
  const status = String(source?.callStatus ?? source?.eventType ?? '');
  if (status === 'call_escalated_to_operator') return 'передан оператору';
  if (status === 'call_completed') return 'завершён';
  if (status === 'call_missed') return 'пропущен';
  if (status === 'call_failed') return 'ошибка звонка';
  if (status === 'call_started') return 'начат';
  const fallback = status.replace(/^call_/, '').replace(/_/g, ' ');
  return fallback || 'звонок';
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'нет данных';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins} мин ${secs} с` : `${secs} с`;
}

function transcriptSnippet(source: PhoneReviewSource | null): string | null {
  const text = String(source?.transcriptText ?? '').trim();
  if (!text) return null;
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function statusBadgeClass(status: ReviewStatus): string {
  if (status === 'pending') return 'bg-amber-100 text-amber-800 ring-1 ring-amber-300';
  if (status === 'acknowledged') return 'bg-blue-100 text-blue-800';
  if (status === 'approved') return 'bg-indigo-100 text-indigo-800';
  if (status === 'replied') return 'bg-emerald-100 text-emerald-800';
  return 'bg-slate-100 text-slate-700';
}

function modeLabel(review: EscalationReview): string {
  if (isClosedReview(review)) return 'ASI отвечает сам';
  if (isManualMode(review)) return 'Ручной режим';
  if (review.status === 'pending') return 'Передано оператору';
  if (review.status === 'replied') return 'Ждём гостя';
  return 'Передано оператору';
}

function matchQuickFilter(review: EscalationReview, quickFilter: QuickFilter): boolean {
  if (quickFilter === 'all') return true;
  if (quickFilter === 'requires_operator') return isRequiresOperator(review);
  if (quickFilter === 'urgent') return isUrgentReview(review);
  if (quickFilter === 'waiting_for_guest') return isWaitingForGuest(review);
  if (quickFilter === 'ai_autopilot') return isAiAutopilotInferred(review);
  if (quickFilter === 'manual') return isManualMode(review);
  if (quickFilter === 'telegram') return review.channel === 'telegram';
  if (quickFilter === 'vk') return review.channel === 'vk';
  if (quickFilter === 'email') return review.channel === 'email';
  if (quickFilter === 'max') return review.channel === 'max';
  if (quickFilter === 'phone') return review.channel === 'phone';
  return isClosedReview(review);
}

function searchableText(review: EscalationReview): string {
  return [
    review.reviewId,
    review.sessionId,
    review.targetId,
    review.reservationId,
    review.propertyId,
    review.leadId,
    review.channel,
    review.escalationReason,
    phoneSource(review)?.callerPhoneNumber,
    phoneSource(review)?.calledNumber,
    phoneSource(review)?.providerCallId,
    phoneSource(review)?.callStatus,
    phoneSource(review)?.transcriptText,
    review.latestMessages.map((m) => m.content).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function timelineEvents(review: EscalationReview): Array<{ label: string; detail?: string; ts: string; tone: 'normal' | 'warn' }> {
  const phone = phoneSource(review);
  const events: Array<{ label: string; detail?: string; ts: string; tone: 'normal' | 'warn' }> = [
    {
      label: 'Передано оператору',
      detail: review.escalationReason,
      ts: review.createdAt,
      tone: isUrgentReview(review) ? 'warn' : 'normal',
    },
  ];
  if (phone) {
    events.push({
      label: `Звонок: ${phoneStatusLabel(phone)}`,
      detail: [
        phone.callerPhoneNumber ? `Гость: ${phone.callerPhoneNumber}` : null,
        phone.calledNumber ? `Номер объекта: ${phone.calledNumber}` : null,
        phone.durationSeconds !== null && phone.durationSeconds !== undefined ? `Длительность: ${formatDuration(phone.durationSeconds)}` : null,
        phone.recordingUrl ? 'Есть запись звонка' : null,
      ].filter(Boolean).join(' | '),
      ts: phone.timestamp ?? review.createdAt,
      tone: isUrgentReview(review) ? 'warn' : 'normal',
    });
    if (phone.transcriptText) {
      events.push({
        label: phone.transcriptProcessed ? 'Текст звонка обработан' : 'Текст звонка получен',
        detail: transcriptSnippet(phone) ?? undefined,
        ts: review.updatedAt,
        tone: 'normal',
      });
    }
  }
  for (const msg of review.latestMessages) {
    if (msg.direction === 'inbound') {
      events.push({ label: 'Сообщение гостя получено', detail: msg.content, ts: msg.createdAt, tone: 'normal' });
    } else {
      events.push({ label: 'Ответ отправлен гостю', detail: msg.content, ts: msg.createdAt, tone: 'normal' });
    }
  }
  if (review.status === 'acknowledged') {
    events.push({ label: 'Оператор взял диалог', ts: review.updatedAt, tone: 'normal' });
  }
  if (review.status === 'approved') {
    events.push({ label: 'Черновик ASI принят', ts: review.updatedAt, tone: 'normal' });
  }
  if (review.status === 'replied') {
    events.push({ label: 'Ручной ответ отправлен', ts: review.updatedAt, tone: 'normal' });
  }
  if (review.status === 'closed') {
    events.push({ label: 'Диалог закрыт', ts: review.updatedAt, tone: 'normal' });
    events.push({ label: 'ASI снова отвечает сам', ts: review.updatedAt, tone: 'normal' });
  }
  const reason = review.escalationReason.toLowerCase();
  if (reason.includes('duplicate') || reason.includes('anti-loop')) {
    events.push({
      label: 'Повторный ответ остановлен',
      detail: 'Система не отправила гостю один и тот же ответ повторно.',
      ts: review.updatedAt,
      tone: 'warn',
    });
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

export default function CommunicationPage() {
  const [reviews, setReviews] = useState<EscalationReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<FilterUrgency>('all');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [search, setSearch] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [replyState, setReplyState] = useState<ReplyState>('idle');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [guestMemory, setGuestMemory] = useState<GuestMemoryView | null>(null);
  const [guestMemoryLoading, setGuestMemoryLoading] = useState(false);
  const [guestMemoryError, setGuestMemoryError] = useState<string | null>(null);
  const [guestMemoryBusy, setGuestMemoryBusy] = useState(false);
  const [lifecycleItems, setLifecycleItems] = useState<GuestLifecycleVisibility[]>([]);
  const [lifecycleLoading, setLifecycleLoading] = useState(true);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  async function loadReviews(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/escalation-reviews?limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Не удалось загрузить диалоги (${res.status})`);
      const data = (await res.json()) as ListResponse;
      const list = Array.isArray(data.reviews) ? data.reviews : [];
      setReviews(list);
      setSelectedId((prev) => (prev && list.some((r) => r.reviewId === prev) ? prev : list[0]?.reviewId ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить диалоги');
    } finally {
      setLoading(false);
    }
  }

  async function loadLifecycleItems(): Promise<void> {
    setLifecycleLoading(true);
    setLifecycleError(null);
    try {
      const res = await fetch('/api/operator/lifecycle-communications?limit=200', { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; items?: GuestLifecycleVisibility[]; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? 'Не удалось загрузить этапы проживания');
      setLifecycleItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setLifecycleItems([]);
      setLifecycleError(err instanceof Error ? err.message : 'Не удалось загрузить этапы проживания');
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function loadGuestMemory(reviewId: string): Promise<void> {
    setGuestMemoryLoading(true);
    setGuestMemoryError(null);
    try {
      const res = await fetch(`/api/operator/escalation-reviews/${reviewId}/guest-memory`, { cache: 'no-store' });
      const data = await res.json() as { ok?: boolean; memory?: GuestMemoryView | null; unavailable?: boolean; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? 'Не удалось загрузить память гостя');
      setGuestMemory(data.unavailable ? null : data.memory ?? null);
    } catch (err) {
      setGuestMemory(null);
      setGuestMemoryError(err instanceof Error ? err.message : 'Не удалось загрузить память гостя');
    } finally {
      setGuestMemoryLoading(false);
    }
  }

  async function updateGuestMemory(body: Record<string, unknown>): Promise<void> {
    if (!selectedId) return;
    setGuestMemoryBusy(true);
    setGuestMemoryError(null);
    try {
      const res = await fetch(`/api/operator/escalation-reviews/${selectedId}/guest-memory`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok?: boolean; memory?: GuestMemoryView; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Не удалось обновить память гостя');
      setGuestMemory(data.memory ?? null);
    } catch (err) {
      setGuestMemoryError(err instanceof Error ? err.message : 'Не удалось обновить память гостя');
    } finally {
      setGuestMemoryBusy(false);
    }
  }

  useEffect(() => {
    void loadReviews();
    void loadLifecycleItems();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setGuestMemory(null);
      setGuestMemoryError(null);
      return;
    }
    void loadGuestMemory(selectedId);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reviews.filter((review) => {
      if (statusFilter !== 'all' && review.status !== statusFilter) return false;
      if (urgencyFilter === 'urgent' && !isUrgentReview(review)) return false;
      if (urgencyFilter === 'normal' && isUrgentReview(review)) return false;
      if (!matchQuickFilter(review, quickFilter)) return false;
      if (query && !searchableText(review).includes(query)) return false;
      return true;
    });
  }, [reviews, statusFilter, urgencyFilter, quickFilter, search]);

  const escalationQueue = useMemo(() => reviews.filter((r) => isRequiresOperator(r)), [reviews]);
  const summaryCounts = useMemo(
    () => ({
      all: reviews.length,
      urgent: reviews.filter((r) => isUrgentReview(r)).length,
      requiresOperator: reviews.filter((r) => isRequiresOperator(r)).length,
      waitingForGuest: reviews.filter((r) => isWaitingForGuest(r)).length,
      autopilot: reviews.filter((r) => isAiAutopilotInferred(r)).length,
      closed: reviews.filter((r) => isClosedReview(r)).length,
      manual: reviews.filter((r) => isManualMode(r)).length,
      telegram: reviews.filter((r) => r.channel === 'telegram').length,
      vk: reviews.filter((r) => r.channel === 'vk').length,
      email: reviews.filter((r) => r.channel === 'email').length,
      max: reviews.filter((r) => r.channel === 'max').length,
      phone: reviews.filter((r) => r.channel === 'phone').length,
    }),
    [reviews],
  );

  const selected = reviews.find((r) => r.reviewId === selectedId) ?? null;
  const selectedVisible = filtered.find((r) => r.reviewId === selectedId) ?? null;
  const selectedTimeline = selected ? timelineEvents(selected) : [];
  const lastMessage = selected?.latestMessages.at(-1) ?? null;
  const selectedPhone = selected ? phoneSource(selected) : null;

  async function runAction(action: 'acknowledge' | 'approve' | 'send_reply' | 'return_to_ai' | 'close' | 'take_over_manual') {
    if (!selected) return;
    if (action === 'send_reply' && !replyDraft.trim()) return;
    if (action === 'close') {
      const confirmed = window.confirm('Закрыть диалог как решённый?');
      if (!confirmed) return;
    }
    if (action === 'return_to_ai') {
      const confirmed = window.confirm('Вернуть диалог ASI?');
      if (!confirmed) return;
    }

    const actionToSend = action === 'take_over_manual' ? 'acknowledge' : action;
    const marker = `${actionToSend}:${selected.reviewId}`;
    setBusyAction(marker);
    setError(null);
    setActionMessage(null);
    if (actionToSend === 'send_reply') setReplyState('sending');

    try {
      const res = await fetch(`/api/operator/escalation-reviews/${selected.reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionToSend,
          replyText: actionToSend === 'send_reply' ? replyDraft.trim() : undefined,
        }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) throw new Error(payload.error ?? 'Действие не выполнено');

      if (actionToSend === 'send_reply') {
        setReplyState('saved');
        setActionMessage('Ответ отправлен гостю. Диалог возвращён ASI.');
      } else if (actionToSend === 'approve') {
        setActionMessage('Черновик ASI принят.');
      } else if (actionToSend === 'acknowledge') {
        setActionMessage('Диалог взят в работу.');
      } else if (actionToSend === 'return_to_ai') {
        setActionMessage('Диалог возвращён ASI.');
      } else if (actionToSend === 'close') {
        setActionMessage('Диалог закрыт как решённый.');
      }

      await loadReviews();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Действие не выполнено';
      setError(msg);
      if (actionToSend === 'send_reply') setReplyState('error');
    } finally {
      setBusyAction(null);
      if (actionToSend === 'send_reply') {
        setTimeout(() => setReplyState('idle'), 1500);
      }
    }
  }

  useEffect(() => {
    if (!selected) {
      setReplyDraft('');
      return;
    }
    setReplyDraft(selected.suggestedReply ?? '');
    setReplyState('idle');
  }, [selected]);

  const quickFilterButtons: Array<{ key: QuickFilter; label: string; count: number }> = [
    { key: 'all', label: 'Все диалоги', count: summaryCounts.all },
    { key: 'requires_operator', label: 'Нужен оператор', count: summaryCounts.requiresOperator },
    { key: 'urgent', label: 'Срочно', count: summaryCounts.urgent },
    { key: 'waiting_for_guest', label: 'Ждём гостя', count: summaryCounts.waitingForGuest },
    { key: 'ai_autopilot', label: 'ASI отвечает сам', count: summaryCounts.autopilot },
    { key: 'manual', label: 'Ручной режим', count: summaryCounts.manual },
    { key: 'telegram', label: 'Telegram', count: summaryCounts.telegram },
    { key: 'email', label: 'Email', count: summaryCounts.email },
    { key: 'phone', label: 'Телефон', count: summaryCounts.phone },
    { key: 'closed', label: 'Закрыто', count: summaryCounts.closed },
  ];

  const filterChipClass =
    'inline-flex min-h-9 items-center rounded-full border px-3.5 py-2 text-sm font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1';
  const secondaryActionClass =
    'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2.5 text-sm font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-slate-500 disabled:border-slate-200 disabled:bg-slate-100';
  const primaryActionClass =
    'inline-flex min-h-12 items-center justify-center rounded-md px-5 py-3 text-sm font-semibold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-slate-500 disabled:border-slate-200 disabled:bg-slate-100';

  const channelReadinessCards: ChannelReadinessCard[] = COMMUNICATION_CHANNEL_FOUNDATION.map((item) => ({
    channel: item.channel,
    title: item.labelRu,
    badge: item.dashboardBadgeRu,
    summary: item.summaryRu,
    points: item.pointsRu,
    countLabel: item.countLabelRu,
    count: summaryCounts[item.channel],
    tone: item.readiness === 'active' ? 'primary' : item.readiness === 'foundation' ? 'foundation' : 'planned',
  }));

  const communicationPaths: CommunicationPathCard[] = [
    {
      title: 'Telegram',
      badge: 'Рабочий путь',
      summary: 'Основной маршрут MVP: входящее сообщение гостя проходит через контекст и при риске уходит оператору.',
      steps: [
        'входящее сообщение гостя',
        'роль, сессия и история диалога',
        'объект, бронь или запрос уточнения',
        'срочный доступ и передача оператору',
        'история действий в карточке диалога',
      ],
    },
    {
      title: 'Email',
      badge: 'Полуавто',
      summary: 'Email используется честно: заявки гостей попадают в общий контур, но требуют ручной проверки там, где нет уверенного контекста.',
      steps: [
        'заявка гостя из письма',
        'объект или бронь из данных письма',
        'черновик ответа, если хватает контекста',
        'ручная или полуавто обработка оператором',
      ],
    },
    {
      title: 'Телефон',
      badge: 'План',
      summary: 'Телефон показан как следующий этап: голосовые звонки видны в контуре, но реальная телефония не считается подключенной.',
      steps: [
        'будущий входящий звонок',
        'текст звонка в задачу',
        'срочный доступ по звонку',
        'передача оператору без обещания живой интеграции',
      ],
    },
  ];

  const channelToneClass: Record<ChannelReadinessCard['tone'], string> = {
    primary: 'border-slate-900 bg-slate-950 text-white',
    foundation: 'border-slate-200 bg-white text-slate-900',
    planned: 'border-dashed border-slate-300 bg-slate-50 text-slate-900',
  };

  const channelBadgeClass: Record<ChannelReadinessCard['tone'], string> = {
    primary: 'bg-white/15 text-white ring-1 ring-white/20',
    foundation: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    planned: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  };

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Коммуникация с гостями</h1>
        <p className="text-sm text-slate-600">
          Рабочий экран для сообщений гостей: Telegram уже основной, Email даёт базовый контур, телефон подключается следующим этапом.
        </p>
      </header>

      <section className="grid gap-3 lg:grid-cols-3">
        {channelReadinessCards.map((card) => {
          const isPrimary = card.tone === 'primary';
          return (
            <article key={card.channel} className={`rounded-xl border p-4 shadow-sm ${channelToneClass[card.tone]}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className={`text-lg font-semibold ${isPrimary ? 'text-white' : 'text-slate-900'}`}>{card.title}</h2>
                  <p className={`mt-1 text-sm ${isPrimary ? 'text-slate-200' : 'text-slate-600'}`}>{card.summary}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${channelBadgeClass[card.tone]}`}>
                  {card.badge}
                </span>
              </div>
              <ul className={`mt-4 grid gap-2 text-sm ${isPrimary ? 'text-slate-100' : 'text-slate-700'}`}>
                {card.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span className={isPrimary ? 'text-slate-400' : 'text-slate-400'}>•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <div
                className={`mt-4 rounded-md px-3 py-2 text-sm ${
                  isPrimary ? 'bg-white/10 text-slate-100' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Сейчас в очереди: <span className="font-semibold">{card.count}</span> {card.countLabel}
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Рабочие маршруты</h2>
            <p className="mt-1 text-sm text-slate-600">
              Что уже является основным путем, что работает как фундамент, а что остается следующим этапом.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">MVP readiness</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {communicationPaths.map((path) => (
            <article key={path.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">{path.title}</h3>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  {path.badge}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{path.summary}</p>
              <ol className="mt-3 space-y-1.5 text-sm text-slate-700">
                {path.steps.map((step, idx) => (
                  <li key={step} className="flex gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Этапы проживания и сообщения</h2>
            <p className="mt-1 text-sm text-slate-600">Последнее событие, отправка и сообщения, которые ещё ожидают своего времени.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadLifecycleItems()}
            className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 sm:mt-0"
          >
            Обновить
          </button>
        </div>
        {lifecycleError ? (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{lifecycleError}</div>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Бронь и гость</th>
                <th className="px-3 py-2 font-semibold">Текущий этап</th>
                <th className="px-3 py-2 font-semibold">Последнее событие</th>
                <th className="px-3 py-2 font-semibold">Последнее сообщение</th>
                <th className="px-3 py-2 font-semibold">Следующее сообщение</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {lifecycleLoading ? (
                <tr><td className="px-3 py-5 text-slate-500" colSpan={6}>Загружаем этапы...</td></tr>
              ) : lifecycleItems.length === 0 ? (
                <tr><td className="px-3 py-5 text-slate-500" colSpan={6}>Событий проживания пока нет.</td></tr>
              ) : lifecycleItems.map((item) => (
                <tr key={item.reservationId} className={item.operatorActionRequired ? 'bg-amber-50/60' : undefined}>
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900">{item.reservationId}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{item.guest}</div>
                  </td>
                  <td className="px-3 py-3">{lifecycleStageLabel(item.currentStage)}</td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-800">{item.mostRecentEvent}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{shortTs(item.mostRecentEventAt)}</div>
                  </td>
                  <td className="max-w-xs px-3 py-3 text-slate-600">{item.mostRecentCommunication ?? 'Сообщения не было'}</td>
                  <td className="px-3 py-3 text-slate-600">
                    {item.pendingScheduledCommunication
                      ? `${item.pendingScheduledCommunication.eventType} — ${shortTs(item.pendingScheduledCommunication.scheduledFor)}`
                      : 'Нет запланированных'}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      item.operatorActionRequired ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {item.operatorActionRequired ? 'Нужен оператор' : lifecycleDeliveryLabel(item.deliveryStatus)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 xl:grid-cols-[2fr_1fr_1fr]">
          <label className="text-sm text-slate-700">
            Поиск
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Гость, сообщение, бронь, объект, канал или причина передачи"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="text-sm text-slate-700">
            Статус
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            >
              <option value="all">Все</option>
              <option value="pending">{statusLabel('pending')}</option>
              <option value="acknowledged">{statusLabel('acknowledged')}</option>
              <option value="approved">{statusLabel('approved')}</option>
              <option value="replied">{statusLabel('replied')}</option>
              <option value="closed">{statusLabel('closed')}</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Срочность
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value as FilterUrgency)}
            >
              <option value="all">Все</option>
              <option value="urgent">Срочно</option>
              <option value="normal">Обычный</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {quickFilterButtons.map((f) => {
            const active = quickFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setQuickFilter(f.key)}
                className={`${filterChipClass} ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <span>{f.label}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
            Очередь оператора: <span className="font-semibold text-amber-800">{escalationQueue.length}</span>
          </div>
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
            Срочно: <span className="font-semibold text-rose-700">{summaryCounts.urgent}</span>
          </div>
          <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
            Ручной режим: <span className="font-semibold text-indigo-700">{summaryCounts.manual}</span>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
            ASI отвечает сам: <span className="font-semibold text-emerald-700">{summaryCounts.autopilot}</span>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {actionMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{actionMessage}</div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Входящие от гостей</div>
          <div className="max-h-[75vh] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Загружаем диалоги...</div>
            ) : reviews.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">Диалогов пока нет.</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">По этим фильтрам ничего не найдено.</div>
            ) : (
              filtered.map((review) => {
                const active = review.reviewId === selectedId;
                const lastInbound = [...review.latestMessages].reverse().find((m) => m.direction === 'inbound');
                const urgent = isUrgentReview(review);
                const closed = isClosedReview(review);
                const phone = phoneSource(review);
                const preview = phone
                  ? `Звонок ${phoneStatusLabel(phone)}${phone.callerPhoneNumber ? ` от ${phone.callerPhoneNumber}` : ''}${
                      transcriptSnippet(phone) ? `: ${transcriptSnippet(phone)}` : ''
                    }`
                  : lastInbound?.content ?? 'Нет входящего сообщения';
                return (
                  <button
                    key={review.reviewId}
                    type="button"
                    onClick={() => setSelectedId(review.reviewId)}
                    className={`w-full border-b border-slate-100 px-4 py-3 text-left transition ${
                      active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    } ${urgent ? 'border-l-4 border-l-rose-500' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wide text-slate-500">{channelLabel(review.channel)}</span>
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(review.status)}`}>
                        {statusLabel(review.status)}
                      </span>
                    </div>
                    <p className={`mt-1 line-clamp-2 text-sm ${closed ? 'text-slate-500' : 'text-slate-800'}`}>
                      {preview}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className={urgent ? 'font-semibold text-rose-600' : 'text-slate-500'}>
                        {urgent ? 'Срочная передача' : modeLabel(review)}
                      </span>
                      <span className="text-slate-500">{shortTs(review.updatedAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="space-y-4">
          {!selected ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              Выберите диалог слева, чтобы увидеть контекст и действия.
            </div>
          ) : !selectedVisible ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              Выбранный диалог скрыт фильтрами. Измените фильтры, чтобы вернуть его в список.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Контекст диалога</h2>
                <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                  <div>
                    <span className="text-slate-500">Канал:</span> {channelLabel(selected.channel)}
                  </div>
                  <div>
                    <span className="text-slate-500">Гость:</span> {selected.targetId}
                  </div>
                  {selectedPhone ? (
                    <>
                      <div>
                        <span className="text-slate-500">Телефон гостя:</span> {selectedPhone.callerPhoneNumber ?? selected.targetId}
                      </div>
                      <div>
                        <span className="text-slate-500">Номер объекта:</span> {selectedPhone.calledNumber ?? 'нет данных'}
                      </div>
                      <div>
                        <span className="text-slate-500">Статус звонка:</span> {phoneStatusLabel(selectedPhone)}
                      </div>
                      <div>
                        <span className="text-slate-500">Длительность:</span> {formatDuration(selectedPhone.durationSeconds)}
                      </div>
                      <div>
                        <span className="text-slate-500">ID звонка:</span> {selectedPhone.providerCallId ?? 'нет данных'}
                      </div>
                      <div>
                        <span className="text-slate-500">Провайдер:</span> {selectedPhone.provider ?? 'нет данных'}
                      </div>
                    </>
                  ) : null}
                  <div>
                    <span className="text-slate-500">ID сессии:</span> {selected.sessionId}
                  </div>
                  <div>
                    <span className="text-slate-500">Режим:</span> {modeLabel(selected)}
                  </div>
                  <div>
                    <span className="text-slate-500">Бронь:</span> {selected.reservationId ?? 'нет данных'}
                  </div>
                  <div>
                    <span className="text-slate-500">Объект:</span> {selected.propertyId ?? 'нет данных'}
                  </div>
                  <div>
                    <span className="text-slate-500">Заявка:</span> {selected.leadId ?? 'нет данных'}
                  </div>
                  <div>
                    <span className="text-slate-500">Срочность:</span> {isUrgentReview(selected) ? 'Срочно' : 'Обычная'}
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-slate-500">Почему передано оператору:</span> {selected.escalationReason}
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-slate-500">Последнее сообщение:</span> {lastMessage?.content ?? 'Сообщений пока нет'}
                  </div>
                  {selectedPhone ? (
                    <>
                      <div className="md:col-span-2">
                        <span className="text-slate-500">Текст звонка:</span> {transcriptSnippet(selectedPhone) ?? 'нет данных'}
                      </div>
                      <div className="md:col-span-2">
                        <span className="text-slate-500">Запись звонка:</span>{' '}
                        {selectedPhone.recordingUrl ? (
                          <a className="text-indigo-700 underline" href={selectedPhone.recordingUrl} target="_blank" rel="noreferrer">
                            Открыть запись
                          </a>
                        ) : (
                          'нет данных'
                        )}
                      </div>
                    </>
                  ) : null}
                  <div>
                    <span className="text-slate-500">Создано:</span> {shortTs(selected.createdAt)}
                  </div>
                  <div>
                    <span className="text-slate-500">Обновлено:</span> {shortTs(selected.updatedAt)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Память о госте</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Только подтверждённые предпочтения и важные события. Текущая бронь и данные объекта всегда важнее этой истории.
                    </p>
                  </div>
                  {guestMemory?.profile ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      {isReturningGuestProfile(guestMemory.profile)
                        ? 'Гость вернулся'
                        : 'Первое обращение'}
                    </span>
                  ) : null}
                </div>

                {guestMemoryLoading ? (
                  <div className="mt-3 text-sm text-slate-500">Загружаем память гостя...</div>
                ) : guestMemoryError ? (
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {guestMemoryError}
                  </div>
                ) : !guestMemory ? (
                  <div className="mt-3 text-sm text-slate-500">Для этого диалога память гостя пока недоступна.</div>
                ) : (
                  <div className="mt-3 space-y-4">
                    <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                      <div><span className="text-slate-500">Проживаний:</span> {guestMemory.profile?.stayCount ?? 0}</div>
                      <div><span className="text-slate-500">Последнее:</span> {guestMemory.profile?.lastStayAt ? shortTs(guestMemory.profile.lastStayAt) : 'нет данных'}</div>
                      <div><span className="text-slate-500">Язык:</span> {guestMemory.profile?.preferredLanguage === 'en' ? 'английский' : guestMemory.profile?.preferredLanguage === 'ru' ? 'русский' : 'не указан'}</div>
                      <div><span className="text-slate-500">Формат:</span> {guestMemory.profile?.preferredCommunicationMode === 'voice' ? 'голос' : guestMemory.profile?.preferredCommunicationMode === 'text' ? 'текст' : 'не указан'}</div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Предпочтения</div>
                      {guestMemory.preferences.length === 0 ? (
                        <div className="mt-2 text-sm text-slate-500">Нет сохранённых предпочтений.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {guestMemory.preferences.map((preference) => (
                            <div key={preference.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                              <div className="text-sm text-slate-700">
                                <span className="font-medium text-slate-900">{preferenceLabel(preference.key)}:</span> {preference.value}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={guestMemoryBusy}
                                  className="text-xs font-semibold text-indigo-700 disabled:text-slate-400"
                                  onClick={() => {
                                    const value = window.prompt('Уточните предпочтение гостя', preference.value)?.trim();
                                    if (value && value !== preference.value) {
                                      void updateGuestMemory({ action: 'correct_preference', key: preference.key, value });
                                    }
                                  }}
                                >
                                  Исправить
                                </button>
                                <button
                                  type="button"
                                  disabled={guestMemoryBusy}
                                  className="text-xs font-semibold text-red-700 disabled:text-slate-400"
                                  onClick={() => void updateGuestMemory({ action: 'delete_preference', itemId: preference.id })}
                                >
                                  Удалить
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Недавние важные события</div>
                      {guestMemory.events.length === 0 ? (
                        <div className="mt-2 text-sm text-slate-500">Важных событий пока нет.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {guestMemory.events.slice(0, 8).map((event) => (
                            <div key={event.id} className="rounded-md border border-slate-200 px-3 py-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium text-slate-900">{memoryEventLabel(event.type)}</div>
                                  <div className="mt-1 text-sm text-slate-700">{event.summary}</div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {shortTs(event.occurredAt)}{event.historyOnly ? ' · это история, не новое согласование' : ''}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={guestMemoryBusy}
                                    className="text-xs font-semibold text-indigo-700 disabled:text-slate-400"
                                    onClick={() => {
                                      const summary = window.prompt('Уточните итог события', event.summary)?.trim();
                                      if (summary && summary !== event.summary) {
                                        void updateGuestMemory({
                                          action: 'correct_event',
                                          itemId: event.id,
                                          type: event.type,
                                          summary,
                                          occurredAt: event.occurredAt,
                                        });
                                      }
                                    }}
                                  >
                                    Исправить
                                  </button>
                                  <button
                                    type="button"
                                    disabled={guestMemoryBusy}
                                    className="text-xs font-semibold text-red-700 disabled:text-slate-400"
                                    onClick={() => void updateGuestMemory({ action: 'delete_event', itemId: event.id })}
                                  >
                                    Удалить
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={guestMemoryBusy}
                      className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:text-slate-400"
                      onClick={() => {
                        if (window.confirm('Удалить всю долгосрочную память об этом госте?')) {
                          void updateGuestMemory({ action: 'forget_all' });
                        }
                      }}
                    >
                      Забыть данные гостя
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Действия оператора</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Ответьте гостю вручную, закройте срочный вопрос или верните диалог ASI.
                </p>

                {selected.suggestedReply ? (
                  <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Черновик ASI</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-indigo-900">{selected.suggestedReply}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setReplyDraft(selected.suggestedReply ?? '')}
                        className={`${secondaryActionClass} border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100`}
                      >
                        Вставить в ответ
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction('approve')}
                        disabled={busyAction !== null}
                        className={`${primaryActionClass} border border-indigo-200 bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:text-slate-500 disabled:bg-slate-100`}
                      >
                        Принять черновик
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    Для этого диалога пока нет черновика ASI.
                  </div>
                )}

                <label className="mt-4 block text-sm font-medium text-slate-800">
                  Ответ гостю
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    disabled={!selected || busyAction !== null}
                    placeholder="Напишите ответ или отредактируйте черновик ASI"
                    className="mt-2 min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </label>

                <div className="mt-2 text-xs text-slate-500">
                  {replyState === 'sending'
                    ? 'Отправляем...'
                    : replyState === 'saved'
                      ? 'Ответ отправлен.'
                      : replyState === 'error'
                        ? 'Не удалось отправить.'
                        : 'Готово к отправке.'}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void runAction('acknowledge')}
                    disabled={!selected || busyAction !== null}
                    className={`${secondaryActionClass} border-slate-300 text-slate-700 hover:bg-slate-50`}
                  >
                    Взять в работу
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('take_over_manual')}
                    disabled={!selected || busyAction !== null}
                    className={`${secondaryActionClass} border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:text-slate-500 disabled:bg-slate-100`}
                  >
                    Перейти в ручной режим
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('send_reply')}
                    disabled={!selected || busyAction !== null || !replyDraft.trim()}
                    className={`${primaryActionClass} border border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-800 disabled:shadow-none`}
                  >
                    Отправить и вернуть ASI
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('return_to_ai')}
                    disabled={!selected || busyAction !== null}
                    className={`${primaryActionClass} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:text-slate-500 disabled:bg-slate-100`}
                  >
                    Вернуть ASI
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('close')}
                    disabled={!selected || busyAction !== null}
                    className={`${primaryActionClass} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:text-slate-500 disabled:bg-slate-100`}
                  >
                    Закрыть
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">История диалога</h3>
                <ol className="mt-3 space-y-2 text-sm">
                  {selectedTimeline.map((event, idx) => (
                    <li
                      key={`${event.ts}-${idx}`}
                      className={`rounded border px-3 py-2 ${
                        event.tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="font-medium text-slate-800">{event.label}</div>
                      {event.detail ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{event.detail}</p> : null}
                      <div className="mt-1 text-xs text-slate-500">{shortTs(event.ts)}</div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
