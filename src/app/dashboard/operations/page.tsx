'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  demoOperationsBookings,
  operationsStageLabels,
  operationsStageOrder,
} from '@/lib/operations/demo-data';
import type {
  OperationsAutomationMode,
  OperationsBookingIntake,
  OperationsCheckoutStatus,
  OperationsCheckInStatus,
  OperationsIssueStatus,
  OperationsWorkflowStage,
} from '@/lib/operations/types';

type ActionKind =
  | 'checkin_ready'
  | 'guest_checked_in'
  | 'checked_out'
  | 'create_issue'
  | 'escalate_operator'
  | 'close_issue';

const automationLabels: Record<OperationsAutomationMode, string> = {
  manual: 'Manual',
  semi_automated: 'Semi-automated',
  fully_automated: 'Fully automated',
};

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(source: OperationsBookingIntake['source']): string {
  if (source === 'telegram') return 'Telegram';
  if (source === 'email') return 'Email';
  if (source === 'phone') return 'Phone';
  if (source === 'direct') return 'Direct';
  if (source === 'demo') return 'Demo';
  return source;
}

function stageTone(stage: OperationsWorkflowStage): string {
  if (stage === 'needs_operator') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (stage === 'checkin_today') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (stage === 'in_stay') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (stage === 'checkout') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function automationTone(mode: OperationsAutomationMode): string {
  if (mode === 'fully_automated') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (mode === 'semi_automated') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function issueTone(status: OperationsIssueStatus): string {
  if (status === 'urgent' || status === 'escalated') return 'text-rose-700';
  if (status === 'open') return 'text-amber-700';
  if (status === 'closed') return 'text-emerald-700';
  return 'text-slate-500';
}

function checklistClass(status: OperationsBookingIntake['checklist'][number]['status']): string {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'blocked') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'not_applicable') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function applyDemoAction(item: OperationsBookingIntake, action: ActionKind): OperationsBookingIntake {
  const now = new Date().toISOString();
  let stage = item.stage;
  let status = item.status;
  let checkInStatus: OperationsCheckInStatus = item.checkInStatus;
  let checkoutStatus: OperationsCheckoutStatus = item.checkoutStatus;
  let issueStatus: OperationsIssueStatus = item.issueStatus;
  let timelineLabel = '';

  if (action === 'checkin_ready') {
    stage = 'pre_checkin';
    status = 'pre_checkin';
    checkInStatus = 'ready';
    timelineLabel = 'Marked check-in ready';
  }
  if (action === 'guest_checked_in') {
    stage = 'in_stay';
    status = 'in_stay';
    checkInStatus = 'guest_checked_in';
    checkoutStatus = item.checkoutStatus === 'not_started' ? 'scheduled' : item.checkoutStatus;
    timelineLabel = 'Marked guest checked in';
  }
  if (action === 'checked_out') {
    stage = 'review_followup';
    status = 'followup';
    checkoutStatus = 'guest_checked_out';
    timelineLabel = 'Marked guest checked out';
  }
  if (action === 'create_issue') {
    issueStatus = 'open';
    timelineLabel = 'Issue created';
  }
  if (action === 'escalate_operator') {
    stage = 'needs_operator';
    status = 'needs_operator';
    issueStatus = 'escalated';
    checkInStatus = item.checkInStatus === 'ready' ? item.checkInStatus : 'operator_review';
    timelineLabel = 'Escalated to operator';
  }
  if (action === 'close_issue') {
    issueStatus = 'closed';
    timelineLabel = 'Issue closed';
  }

  return {
    ...item,
    stage,
    status,
    checkInStatus,
    checkoutStatus,
    issueStatus,
    notes: Array.from(new Set([...item.notes, 'Demo-only action applied locally. No backend record was changed.'])),
    updatedAt: now,
    timeline: [
      ...item.timeline,
      {
        id: `${item.id}-${action}-${now}`,
        label: timelineLabel,
        detail: 'Phase 1 dashboard demo action. Connect backend workflow later.',
        createdAt: now,
        tone: action === 'escalate_operator' ? 'warn' : action === 'close_issue' ? 'success' : 'normal',
      },
    ],
  };
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
      title={disabled ? 'Not applicable for this demo item' : 'Demo-only action'}
    >
      {children}
    </button>
  );
}

function OverviewCard({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function BookingCard({
  item,
  selected,
  onSelect,
}: {
  item: OperationsBookingIntake;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article
      className={`rounded-lg border bg-white p-3 shadow-sm transition ${
        selected ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{item.guest.guestName}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{item.objectLabel}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${automationTone(item.automationMode)}`}>
          {automationLabels[item.automationMode]}
        </span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-slate-600">
        <p>{formatDate(item.dates.checkIn)} - {formatDate(item.dates.checkOut)} · {item.dates.nights} nights</p>
        <p>Source: {sourceLabel(item.source)}</p>
        <p className={issueTone(item.issueStatus)}>Issue: {item.issueStatus.replace(/_/g, ' ')}</p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Open details
        </button>
        {item.communicationReviewId ? (
          <Link href="/dashboard/communication" className="text-xs font-medium text-indigo-700 hover:underline">
            Communication
          </Link>
        ) : (
          <span className="text-xs text-slate-400">No comm link</span>
        )}
      </div>
    </article>
  );
}

export default function OperationsPage() {
  const [items, setItems] = useState<OperationsBookingIntake[]>(demoOperationsBookings);
  const [selectedId, setSelectedId] = useState(demoOperationsBookings[3]?.id ?? demoOperationsBookings[0].id);
  const [message, setMessage] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const metrics = useMemo(() => {
    const today = '2026-05-08';
    return {
      activeBookings: items.filter((item) => !['lead', 'closed'].includes(item.status)).length,
      upcomingCheckins: items.filter((item) => item.dates.checkIn > today && item.status !== 'closed').length,
      currentStays: items.filter((item) => item.stage === 'in_stay').length,
      checkoutsToday: items.filter((item) => item.dates.checkOut === today).length,
      openIssues: items.filter((item) => item.issueStatus === 'open' || item.issueStatus === 'urgent').length,
      operatorEscalations: items.filter((item) => item.stage === 'needs_operator' || item.issueStatus === 'escalated').length,
      automationStatus: `${items.filter((item) => item.automationMode !== 'manual').length}/${items.length}`,
    };
  }, [items]);

  function runAction(action: ActionKind) {
    setItems((prev) =>
      prev.map((item) => (item.id === selected.id ? applyDemoAction(item, action) : item)),
    );
    setMessage('Demo action applied locally. Backend workflow actions are intentionally not connected in Phase 1.');
  }

  return (
    <div className="max-w-[1500px] space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Operations</h1>
            <p className="mt-1 text-sm text-slate-600">
              Phase 1 workflow layer for short-term rental operations. Demo data only; no PMS, OTA, or separate AI brain is connected.
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            Mock operational workspace
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <OverviewCard label="Active bookings" value={metrics.activeBookings} hint="Non-closed demo items" />
        <OverviewCard label="Upcoming check-ins" value={metrics.upcomingCheckins} hint="Future arrivals" />
        <OverviewCard label="Current stays" value={metrics.currentStays} hint="In-stay column" />
        <OverviewCard label="Checkouts today" value={metrics.checkoutsToday} hint="Demo date: May 8" />
        <OverviewCard label="Open issues" value={metrics.openIssues} hint="Operator-visible items" />
        <OverviewCard label="Operator escalations" value={metrics.operatorEscalations} hint="Needs operator" />
        <OverviewCard label="Automation status" value={metrics.automationStatus} hint="Semi/full demo modes" />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Automation Tiers</h2>
            <p className="mt-1 text-sm text-slate-500">UI-only indicators for tariff/product mode behavior.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['manual', 'semi_automated', 'fully_automated'] as OperationsAutomationMode[]).map((mode) => (
              <span key={mode} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${automationTone(mode)}`}>
                {automationLabels[mode]}
              </span>
            ))}
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-3">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Workflow Board</h2>
              <p className="text-sm text-slate-500">Lead to follow-up, with operator handoff when needed.</p>
            </div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="grid min-w-[1280px] grid-cols-8 gap-3">
              {operationsStageOrder.map((stage) => {
                const columnItems = items.filter((item) => item.stage === stage);
                return (
                  <section key={stage} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div className={`mb-2 rounded-md border px-2 py-2 text-xs font-semibold ${stageTone(stage)}`}>
                      {operationsStageLabels[stage]}
                      <span className="ml-2 text-slate-500">{columnItems.length}</span>
                    </div>
                    <div className="space-y-2">
                      {columnItems.length > 0 ? (
                        columnItems.map((item) => (
                          <BookingCard
                            key={item.id}
                            item={item}
                            selected={selected.id === item.id}
                            onSelect={() => setSelectedId(item.id)}
                          />
                        ))
                      ) : (
                        <div className="rounded-md border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-400">
                          No demo items
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Selected item</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">{selected.guest.guestName}</h2>
              <p className="mt-1 text-sm text-slate-500">{selected.id}</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${stageTone(selected.stage)}`}>
              {operationsStageLabels[selected.stage]}
            </span>
          </div>

          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Object:</span> {selected.objectLabel}
            </div>
            <div>
              <span className="text-slate-500">Source:</span> {sourceLabel(selected.source)}
            </div>
            <div>
              <span className="text-slate-500">Dates:</span> {formatDate(selected.dates.checkIn)} - {formatDate(selected.dates.checkOut)}
            </div>
            <div>
              <span className="text-slate-500">Payment:</span> {selected.paymentStatus.replace(/_/g, ' ')}
            </div>
            <div>
              <span className="text-slate-500">Check-in:</span> {selected.checkInStatus.replace(/_/g, ' ')}
            </div>
            <div>
              <span className="text-slate-500">Checkout:</span> {selected.checkoutStatus.replace(/_/g, ' ')}
            </div>
            <div>
              <span className="text-slate-500">Issue:</span>{' '}
              <span className={issueTone(selected.issueStatus)}>{selected.issueStatus.replace(/_/g, ' ')}</span>
            </div>
            <div>
              <span className="text-slate-500">Mode:</span> {automationLabels[selected.automationMode]}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Canon-Safe Context</h3>
            <div className="mt-2 grid gap-2 text-xs text-slate-600">
              <p>Access instructions: Configured per object policy</p>
              <p>Wi-Fi / parking / pets / refunds: Requires property context</p>
              <p>Guest-facing answers: Use communication canon and escalation rules</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Operational Checklist</h3>
            <div className="mt-2 space-y-2">
              {selected.checklist.map((item) => (
                <div key={item.id} className={`rounded-md border px-3 py-2 text-sm ${checklistClass(item.status)}`}>
                  <div className="font-medium">{item.label}</div>
                  {item.note ? <div className="mt-0.5 text-xs opacity-80">{item.note}</div> : null}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Actions</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <ActionButton onClick={() => setMessage('Details are open in the right panel. This is the Phase 1 detail view.')}>
                Open details
              </ActionButton>
              <ActionButton onClick={() => runAction('checkin_ready')} disabled={selected.checkInStatus === 'guest_checked_in'}>
                Mark check-in ready
              </ActionButton>
              <ActionButton onClick={() => runAction('guest_checked_in')} disabled={selected.checkoutStatus === 'completed'}>
                Mark guest checked in
              </ActionButton>
              <ActionButton onClick={() => runAction('checked_out')} disabled={selected.stage === 'new_inquiry' || selected.stage === 'booking_intake'}>
                Mark checked out
              </ActionButton>
              <ActionButton onClick={() => runAction('create_issue')} disabled={selected.issueStatus === 'open' || selected.issueStatus === 'escalated'}>
                Create issue
              </ActionButton>
              <ActionButton onClick={() => runAction('escalate_operator')}>
                Escalate to operator
              </ActionButton>
              <ActionButton onClick={() => runAction('close_issue')} disabled={selected.issueStatus === 'none' || selected.issueStatus === 'closed'}>
                Close issue
              </ActionButton>
              {selected.communicationReviewId ? (
                <Link
                  href="/dashboard/communication"
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
                >
                  Send to communication dashboard
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-400"
                >
                  No communication link
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">Action buttons are local demo controls until backend workflow actions are connected.</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {selected.notes.map((note) => (
                <li key={note}>- {note}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Audit Timeline</h3>
            <ol className="mt-2 space-y-2">
              {selected.timeline.map((event) => (
                <li
                  key={event.id}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    event.tone === 'warn'
                      ? 'border-amber-200 bg-amber-50'
                      : event.tone === 'success'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="font-medium text-slate-800">{event.label}</div>
                  {event.detail ? <div className="mt-0.5 text-slate-600">{event.detail}</div> : null}
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.createdAt)}</div>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </section>
    </div>
  );
}
