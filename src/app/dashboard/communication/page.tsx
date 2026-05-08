'use client';

import { useEffect, useMemo, useState } from 'react';

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

type FilterStatus = 'all' | ReviewStatus;
type FilterUrgency = 'all' | 'urgent' | 'normal';

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

function channelLabel(channel: Channel): string {
  if (channel === 'telegram') return 'Telegram';
  if (channel === 'vk') return 'VK';
  if (channel === 'email') return 'Email';
  if (channel === 'max') return 'MAX';
  if (channel === 'phone') return 'Phone';
  return channel;
}

function phoneSource(review: EscalationReview): PhoneReviewSource | null {
  if (review.channel !== 'phone') return null;
  const source = review.source as PhoneReviewSource | undefined;
  if (!source || source.source !== 'phone_call') return null;
  return source;
}

function phoneStatusLabel(source: PhoneReviewSource | null): string {
  const status = String(source?.callStatus ?? source?.eventType ?? '').replace(/^call_/, '').replace(/_/g, ' ');
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Phone call';
}

function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'n/a';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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
  if (isClosedReview(review)) return 'AI autopilot';
  if (isManualMode(review)) return 'Manual mode';
  if (review.status === 'pending') return 'Escalated';
  if (review.status === 'replied') return 'Waiting for guest';
  return 'Escalated';
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
      label: 'Escalated to operator',
      detail: review.escalationReason,
      ts: review.createdAt,
      tone: isUrgentReview(review) ? 'warn' : 'normal',
    },
  ];
  if (phone) {
    events.push({
      label: `Phone ${phoneStatusLabel(phone)}`,
      detail: [
        phone.callerPhoneNumber ? `Caller: ${phone.callerPhoneNumber}` : null,
        phone.calledNumber ? `Called: ${phone.calledNumber}` : null,
        phone.durationSeconds !== null && phone.durationSeconds !== undefined ? `Duration: ${formatDuration(phone.durationSeconds)}` : null,
        phone.recordingUrl ? 'Recording attached' : null,
      ].filter(Boolean).join(' | '),
      ts: phone.timestamp ?? review.createdAt,
      tone: isUrgentReview(review) ? 'warn' : 'normal',
    });
    if (phone.transcriptText) {
      events.push({
        label: phone.transcriptProcessed ? 'Transcript routed through shared canon' : 'Transcript received',
        detail: transcriptSnippet(phone) ?? undefined,
        ts: review.updatedAt,
        tone: 'normal',
      });
    }
  }
  for (const msg of review.latestMessages) {
    if (msg.direction === 'inbound') {
      events.push({ label: 'Message received', detail: msg.content, ts: msg.createdAt, tone: 'normal' });
    } else {
      events.push({ label: 'AI replied / operator reply sent', detail: msg.content, ts: msg.createdAt, tone: 'normal' });
    }
  }
  if (review.status === 'acknowledged') {
    events.push({ label: 'Operator acknowledged', ts: review.updatedAt, tone: 'normal' });
  }
  if (review.status === 'approved') {
    events.push({ label: 'AI draft approved', ts: review.updatedAt, tone: 'normal' });
  }
  if (review.status === 'replied') {
    events.push({ label: 'Manual reply sent', ts: review.updatedAt, tone: 'normal' });
  }
  if (review.status === 'closed') {
    events.push({ label: 'Closed / resolved', ts: review.updatedAt, tone: 'normal' });
    events.push({ label: 'Returned to AI autopilot', ts: review.updatedAt, tone: 'normal' });
  }
  const reason = review.escalationReason.toLowerCase();
  if (reason.includes('duplicate') || reason.includes('anti-loop')) {
    events.push({
      label: 'Anti-loop prevented repeated reply',
      detail: 'System idempotency guard blocked duplicate outbound action.',
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

  async function loadReviews(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/escalation-reviews?limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load inbox (${res.status})`);
      const data = (await res.json()) as ListResponse;
      const list = Array.isArray(data.reviews) ? data.reviews : [];
      setReviews(list);
      setSelectedId((prev) => (prev && list.some((r) => r.reviewId === prev) ? prev : list[0]?.reviewId ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReviews();
  }, []);

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
      const confirmed = window.confirm('Close this conversation as resolved?');
      if (!confirmed) return;
    }
    if (action === 'return_to_ai') {
      const confirmed = window.confirm('Return this conversation to AI autopilot?');
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
      if (!res.ok || !payload.ok) throw new Error(payload.error ?? 'Action failed');

      if (actionToSend === 'send_reply') {
        setReplyState('saved');
        setActionMessage('Manual reply sent.');
      } else if (actionToSend === 'approve') {
        setActionMessage('AI draft approved.');
      } else if (actionToSend === 'acknowledge') {
        setActionMessage('Conversation acknowledged.');
      } else if (actionToSend === 'return_to_ai') {
        setActionMessage('Conversation returned to AI autopilot.');
      } else if (actionToSend === 'close') {
        setActionMessage('Conversation closed as resolved.');
      }

      await loadReviews();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed';
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
    { key: 'all', label: 'All conversations', count: summaryCounts.all },
    { key: 'requires_operator', label: 'Requires operator', count: summaryCounts.requiresOperator },
    { key: 'urgent', label: 'Urgent', count: summaryCounts.urgent },
    { key: 'waiting_for_guest', label: 'Waiting for guest', count: summaryCounts.waitingForGuest },
    { key: 'ai_autopilot', label: 'AI autopilot active', count: summaryCounts.autopilot },
    { key: 'manual', label: 'Manual mode', count: summaryCounts.manual },
    { key: 'telegram', label: 'Telegram', count: summaryCounts.telegram },
    { key: 'vk', label: 'VK', count: summaryCounts.vk },
    { key: 'email', label: 'Email', count: summaryCounts.email },
    { key: 'max', label: 'MAX', count: summaryCounts.max },
    { key: 'phone', label: 'Phone', count: summaryCounts.phone },
    { key: 'closed', label: 'Closed / resolved', count: summaryCounts.closed },
  ];

  const filterChipClass =
    'inline-flex min-h-9 items-center rounded-full border px-3.5 py-2 text-sm font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1';
  const secondaryActionClass =
    'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2.5 text-sm font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-slate-500 disabled:border-slate-200 disabled:bg-slate-100';
  const primaryActionClass =
    'inline-flex min-h-12 items-center justify-center rounded-md px-5 py-3 text-sm font-semibold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:text-slate-500 disabled:border-slate-200 disabled:bg-slate-100';

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Communications Dashboard</h1>
        <p className="text-sm text-slate-600">
          Unified operator console for Telegram, VK, Email, MAX, and Phone with shared orchestration, escalation, and audit control.
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 xl:grid-cols-[2fr_1fr_1fr]">
          <label className="text-sm text-slate-700">
            Search
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Search guest / message / booking / object / session / channel / escalation reason"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="text-sm text-slate-700">
            Status
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="approved">Approved</option>
              <option value="replied">Replied</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Urgency
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value as FilterUrgency)}
            >
              <option value="all">All</option>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
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
            Escalation queue: <span className="font-semibold text-amber-800">{escalationQueue.length}</span>
          </div>
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
            Urgent: <span className="font-semibold text-rose-700">{summaryCounts.urgent}</span>
          </div>
          <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2">
            Manual mode: <span className="font-semibold text-indigo-700">{summaryCounts.manual}</span>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
            AI autopilot inferred: <span className="font-semibold text-emerald-700">{summaryCounts.autopilot}</span>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {actionMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{actionMessage}</div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">Unified Inbox</div>
          <div className="max-h-[75vh] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading conversations...</div>
            ) : reviews.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No conversations yet.</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No matching filters or search query.</div>
            ) : (
              filtered.map((review) => {
                const active = review.reviewId === selectedId;
                const lastInbound = [...review.latestMessages].reverse().find((m) => m.direction === 'inbound');
                const urgent = isUrgentReview(review);
                const closed = isClosedReview(review);
                const phone = phoneSource(review);
                const preview = phone
                  ? `${phoneStatusLabel(phone)}${phone.callerPhoneNumber ? ` from ${phone.callerPhoneNumber}` : ''}${
                      transcriptSnippet(phone) ? `: ${transcriptSnippet(phone)}` : ''
                    }`
                  : lastInbound?.content ?? 'No inbound message in snapshot';
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
                        {review.status}
                      </span>
                    </div>
                    <p className={`mt-1 line-clamp-2 text-sm ${closed ? 'text-slate-500' : 'text-slate-800'}`}>
                      {preview}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className={urgent ? 'font-semibold text-rose-600' : 'text-slate-500'}>
                        {urgent ? 'Urgent escalation' : modeLabel(review)}
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
              No conversation selected. Pick one from the inbox to view details and actions.
            </div>
          ) : !selectedVisible ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
              Selected conversation is hidden by current filters. Adjust filters to bring it back into the inbox list.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-base font-semibold text-slate-900">Conversation Detail</h2>
                <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                  <div>
                    <span className="text-slate-500">Channel:</span> {channelLabel(selected.channel)}
                  </div>
                  <div>
                    <span className="text-slate-500">Guest identifier:</span> {selected.targetId}
                  </div>
                  {selectedPhone ? (
                    <>
                      <div>
                        <span className="text-slate-500">Caller phone:</span> {selectedPhone.callerPhoneNumber ?? selected.targetId}
                      </div>
                      <div>
                        <span className="text-slate-500">Called number:</span> {selectedPhone.calledNumber ?? 'n/a'}
                      </div>
                      <div>
                        <span className="text-slate-500">Call status:</span> {phoneStatusLabel(selectedPhone)}
                      </div>
                      <div>
                        <span className="text-slate-500">Duration:</span> {formatDuration(selectedPhone.durationSeconds)}
                      </div>
                      <div>
                        <span className="text-slate-500">Provider call ID:</span> {selectedPhone.providerCallId ?? 'n/a'}
                      </div>
                      <div>
                        <span className="text-slate-500">Provider:</span> {selectedPhone.provider ?? 'generic'}
                      </div>
                    </>
                  ) : null}
                  <div>
                    <span className="text-slate-500">Session ID:</span> {selected.sessionId}
                  </div>
                  <div>
                    <span className="text-slate-500">Mode:</span> {modeLabel(selected)}
                  </div>
                  <div>
                    <span className="text-slate-500">Booking context:</span> {selected.reservationId ?? 'n/a'}
                  </div>
                  <div>
                    <span className="text-slate-500">Object/property:</span> {selected.propertyId ?? 'n/a'}
                  </div>
                  <div>
                    <span className="text-slate-500">Lead:</span> {selected.leadId ?? 'n/a'}
                  </div>
                  <div>
                    <span className="text-slate-500">Urgency:</span> {isUrgentReview(selected) ? 'Urgent' : 'Normal'}
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-slate-500">Escalation reason:</span> {selected.escalationReason}
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-slate-500">Last message:</span> {lastMessage?.content ?? 'No recent message'}
                  </div>
                  {selectedPhone ? (
                    <>
                      <div className="md:col-span-2">
                        <span className="text-slate-500">Transcript:</span> {transcriptSnippet(selectedPhone) ?? 'n/a'}
                      </div>
                      <div className="md:col-span-2">
                        <span className="text-slate-500">Recording:</span>{' '}
                        {selectedPhone.recordingUrl ? (
                          <a className="text-indigo-700 underline" href={selectedPhone.recordingUrl} target="_blank" rel="noreferrer">
                            Open recording
                          </a>
                        ) : (
                          'n/a'
                        )}
                      </div>
                    </>
                  ) : null}
                  <div>
                    <span className="text-slate-500">Created:</span> {shortTs(selected.createdAt)}
                  </div>
                  <div>
                    <span className="text-slate-500">Updated:</span> {shortTs(selected.updatedAt)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Operator Action Panel</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Use manual controls for escalations, then hand back to AI autopilot when safe.
                </p>

                {selected.suggestedReply ? (
                  <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">AI Draft</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-indigo-900">{selected.suggestedReply}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setReplyDraft(selected.suggestedReply ?? '')}
                        className={`${secondaryActionClass} border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100`}
                      >
                        Use draft in editor
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAction('approve')}
                        disabled={busyAction !== null}
                        className={`${primaryActionClass} border border-indigo-200 bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:text-slate-500 disabled:bg-slate-100`}
                      >
                        Approve AI Draft
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    No AI draft is currently attached to this escalation.
                  </div>
                )}

                <label className="mt-4 block text-sm font-medium text-slate-800">
                  Manual reply
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    disabled={!selected || busyAction !== null}
                    placeholder="Type operator reply or edit AI draft before sending"
                    className="mt-2 min-h-32 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                  />
                </label>

                <div className="mt-2 text-xs text-slate-500">
                  {replyState === 'sending'
                    ? 'Sending...'
                    : replyState === 'saved'
                      ? 'Saved and sent.'
                      : replyState === 'error'
                        ? 'Error while sending.'
                        : 'Ready to send.'}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void runAction('acknowledge')}
                    disabled={!selected || busyAction !== null}
                    className={`${secondaryActionClass} border-slate-300 text-slate-700 hover:bg-slate-50`}
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('take_over_manual')}
                    disabled={!selected || busyAction !== null}
                    className={`${secondaryActionClass} border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:text-slate-500 disabled:bg-slate-100`}
                  >
                    Take over manually
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('send_reply')}
                    disabled={!selected || busyAction !== null || !replyDraft.trim()}
                    className={`${primaryActionClass} border border-slate-900 bg-slate-900 text-white shadow-sm hover:bg-slate-800 disabled:shadow-none`}
                  >
                    Send manual reply
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('return_to_ai')}
                    disabled={!selected || busyAction !== null}
                    className={`${primaryActionClass} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:text-slate-500 disabled:bg-slate-100`}
                  >
                    Return to AI autopilot
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('close')}
                    disabled={!selected || busyAction !== null}
                    className={`${primaryActionClass} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:text-slate-500 disabled:bg-slate-100`}
                  >
                    Close / resolved
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Audit Timeline</h3>
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
